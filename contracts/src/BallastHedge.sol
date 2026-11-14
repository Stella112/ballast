// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMorpho, MorphoMarketParams, IPoolsRouter} from "../interfaces/IExternal.sol";

interface IBallastFactoryView {
    function accountOf(uint256 tokenId) external view returns (address);
    function nft() external view returns (address);
}

/// @title BallastHedge
/// @notice Optional BTC downside hedge for ONE Ballast account, controlled by whoever currently holds that account's
///         NFT. A short: post MUSD as collateral on a Morpho Blue market, borrow BTC, sell it for MUSD in Mezo Pools;
///         later buy BTC back, repay, and withdraw the collateral. Profit (or what is left) can be sent to the Ballast
///         account and used to repay the Mezo loan.
///
///         RISK: if BTC rises the hedge loses money, and the Morpho position can be liquidated independently of the
///         Mezo loan. Not a guarantee of anything.
/// @dev UNAUDITED. Mezo testnet only. The Morpho Blue instance and its BTC lending liquidity were deployed / supplied by
///      the Ballast team (no Morpho deployment exists on Mezo testnet); see docs/DEPLOYMENTS.md.
contract BallastHedge is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC721 public immutable nft;
    IBallastFactoryView public immutable ballastFactory;
    uint256 public immutable tokenId;
    IMorpho public immutable morpho;
    IPoolsRouter public immutable poolsRouter;
    address public immutable poolFactory;
    IERC20 public immutable musd; // collateral
    IERC20 public immutable btc; // loan asset (Mezo BTC ERC-20)
    address public immutable oracle;
    address public immutable irm;
    uint256 public immutable lltv;
    bytes32 public immutable marketId;

    event HedgeOpened(uint256 collateral, uint256 btcBorrowed, uint256 musdFromSale);
    event HedgeClosed(uint256 musdSpent, uint256 btcRepaid, uint256 collateralReturned, uint256 btcLeft);
    event SentToAccount(address indexed account, uint256 musd, uint256 btc);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NotController();
    error PositionOpen();
    error NoPosition();
    error ZeroAmount();
    error NotEnoughBtcToRepay(uint256 have, uint256 owed);

    modifier onlyController() {
        if (msg.sender != nft.ownerOf(tokenId)) revert NotController();
        _;
    }

    constructor(
        address ballastFactory_,
        uint256 tokenId_,
        address morpho_,
        MorphoMarketParams memory mp,
        address poolsRouter_,
        address poolFactory_
    ) {
        ballastFactory = IBallastFactoryView(ballastFactory_);
        nft = IERC721(IBallastFactoryView(ballastFactory_).nft());
        tokenId = tokenId_;
        morpho = IMorpho(morpho_);
        musd = IERC20(mp.collateralToken);
        btc = IERC20(mp.loanToken);
        oracle = mp.oracle;
        irm = mp.irm;
        lltv = mp.lltv;
        marketId = keccak256(abi.encode(mp));
        poolsRouter = IPoolsRouter(poolsRouter_);
        poolFactory = poolFactory_;
    }

    function marketParams() public view returns (MorphoMarketParams memory) {
        return MorphoMarketParams({loanToken: address(btc), collateralToken: address(musd), oracle: oracle, irm: irm, lltv: lltv});
    }

    function controller() public view returns (address) {
        return nft.ownerOf(tokenId);
    }

    function account() public view returns (address) {
        return ballastFactory.accountOf(tokenId);
    }

    /// @notice Current Morpho position: collateral (MUSD), borrow shares, and BTC owed (as of last accrual, rounded up).
    function positionInfo() public view returns (uint256 collateral, uint256 borrowShares, uint256 btcOwed) {
        (, uint128 bs, uint128 c) = morpho.position(marketId, address(this));
        (,, uint128 tba, uint128 tbs,,) = morpho.market(marketId);
        collateral = c;
        borrowShares = bs;
        // SharesMathLib.toAssetsUp: shares * (totalAssets + 1) / (totalShares + 1e6), rounded up
        btcOwed = bs == 0 ? 0 : (uint256(bs) * (uint256(tba) + 1) + (uint256(tbs) + 1e6) - 1) / (uint256(tbs) + 1e6);
    }

    /// @notice Open the short. Pulls `collateral` MUSD from the controller, borrows `borrowBtc`, sells it for at least
    ///         `minMusdOut` MUSD (kept here to buy the BTC back).
    function open(uint256 collateral, uint256 borrowBtc, uint256 minMusdOut) external onlyController nonReentrant {
        if (collateral == 0 || borrowBtc == 0) revert ZeroAmount();
        (, uint256 bs,) = positionInfo();
        if (bs != 0) revert PositionOpen();
        MorphoMarketParams memory mp = marketParams();

        musd.safeTransferFrom(msg.sender, address(this), collateral);
        musd.forceApprove(address(morpho), collateral);
        morpho.supplyCollateral(mp, collateral, address(this), "");
        morpho.borrow(mp, borrowBtc, 0, address(this), address(this));

        uint256 out = _swap(address(btc), address(musd), borrowBtc, minMusdOut);
        emit HedgeOpened(collateral, borrowBtc, out);
    }

    /// @notice Close the short: optionally pull `topUp` extra MUSD from the controller (needed when the hedge lost
    ///         money: fees, interest or a BTC rise), spend `musdIn` MUSD held here buying BTC, repay the whole Morpho
    ///         debt, and withdraw all collateral back to this contract. Leftover BTC stays here (see sendToAccount).
    function close(uint256 musdIn, uint256 minBtcOut, uint256 topUp) external onlyController nonReentrant {
        MorphoMarketParams memory mp = marketParams();
        morpho.accrueInterest(mp);
        (uint256 collateral, uint256 bs, uint256 owed) = positionInfo();
        if (bs == 0) revert NoPosition();

        if (topUp > 0) musd.safeTransferFrom(msg.sender, address(this), topUp);
        if (musdIn > 0) _swap(address(musd), address(btc), musdIn, minBtcOut);
        uint256 have = btc.balanceOf(address(this));
        if (have < owed) revert NotEnoughBtcToRepay(have, owed);

        btc.forceApprove(address(morpho), owed);
        (uint256 repaid,) = morpho.repay(mp, 0, bs, address(this), "");
        btc.forceApprove(address(morpho), 0);
        morpho.withdrawCollateral(mp, collateral, address(this), address(this));
        emit HedgeClosed(musdIn, repaid, collateral, btc.balanceOf(address(this)));
    }

    /// @notice Send everything held here (MUSD and BTC) to the Ballast account, where the controller can use it to
    ///         repay the Mezo loan. Only when no position is open.
    function sendToAccount() external onlyController nonReentrant {
        (, uint256 bs,) = positionInfo();
        if (bs != 0) revert PositionOpen();
        address acct = account();
        uint256 m = musd.balanceOf(address(this));
        uint256 b = btc.balanceOf(address(this));
        if (m > 0) musd.safeTransfer(acct, m);
        if (b > 0) btc.safeTransfer(acct, b);
        emit SentToAccount(acct, m, b);
    }

    /// @notice Controller can withdraw any token held here (their own funds; while a position is open this can leave
    ///         too little MUSD to buy the BTC back — the controller's choice).
    function withdraw(address token, address to, uint256 amount) external onlyController nonReentrant {
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    function _swap(address from, address to, uint256 amountIn, uint256 minOut) internal returns (uint256 out) {
        IPoolsRouter.Route[] memory route = new IPoolsRouter.Route[](1);
        route[0] = IPoolsRouter.Route({from: from, to: to, stable: false, factory: poolFactory});
        IERC20(from).forceApprove(address(poolsRouter), amountIn);
        uint256[] memory amounts = poolsRouter.swapExactTokensForTokens(amountIn, minOut, route, address(this), block.timestamp);
        IERC20(from).forceApprove(address(poolsRouter), 0);
        out = amounts[amounts.length - 1];
    }
}

/// @title BallastHedgeFactory
/// @notice Creates one BallastHedge per Ballast account, only for the current NFT holder.
contract BallastHedgeFactory {
    address public immutable ballastFactory;
    address public immutable morpho;
    address public immutable poolsRouter;
    address public immutable poolFactory;
    MorphoMarketParams internal _mp;
    mapping(uint256 => address) public hedgeOf;

    event HedgeCreated(uint256 indexed tokenId, address hedge, address controller);

    error NotController();
    error AlreadyExists();

    constructor(address ballastFactory_, address morpho_, MorphoMarketParams memory mp, address poolsRouter_, address poolFactory_) {
        ballastFactory = ballastFactory_;
        morpho = morpho_;
        _mp = mp;
        poolsRouter = poolsRouter_;
        poolFactory = poolFactory_;
    }

    function marketParams() external view returns (MorphoMarketParams memory) {
        return _mp;
    }

    function create(uint256 tokenId) external returns (address hedge) {
        IERC721 n = IERC721(IBallastFactoryView(ballastFactory).nft());
        if (msg.sender != n.ownerOf(tokenId)) revert NotController();
        if (hedgeOf[tokenId] != address(0)) revert AlreadyExists();
        hedge = address(new BallastHedge(ballastFactory, tokenId, morpho, _mp, poolsRouter, poolFactory));
        hedgeOf[tokenId] = hedge;
        emit HedgeCreated(tokenId, hedge, msg.sender);
    }
}
