// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Minimal interfaces for the Mezo MUSD protocol.
// Every signature below was checked against the explorer-verified ABI of the live
// Mezo testnet implementation (source identical to mezo-org/musd @ da7888a).
// See docs/VERIFICATION.md. Do not add functions here without re-verifying.

interface IBorrowerOperations {
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;
    function addColl(address _upperHint, address _lowerHint) external payable;
    function withdrawColl(uint256 _amount, address _upperHint, address _lowerHint) external;
    function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;
    function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;
    function closeTrove() external;
    function claimCollateral() external;
    function minNetDebt() external view returns (uint256);
    function MUSD_GAS_COMPENSATION() external view returns (uint256);
    function getBorrowingFee(uint256 _debt) external view returns (uint256);
}

interface ITroveManager {
    // enum Status { nonExistent, active, closedByOwner, closedByLiquidation, closedByRedemption }
    function getTroveStatus(address _borrower) external view returns (uint8);
    function getTroveDebt(address _borrower) external view returns (uint256);
    function getTroveColl(address _borrower) external view returns (uint256);
    function getTrovePrincipal(address _borrower) external view returns (uint256);
    function getTroveInterestOwed(address _borrower) external view returns (uint256);
    function getNominalICR(address _borrower) external view returns (uint256);
    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);
}

interface ISortedTroves {
    function getFirst() external view returns (address);
    function getLast() external view returns (address);
    function getNext(address _id) external view returns (address);
    function getPrev(address _id) external view returns (address);
    function getSize() external view returns (uint256);
    function contains(address _id) external view returns (bool);
    function findInsertPosition(uint256 _NICR, address _prevId, address _nextId)
        external
        view
        returns (address, address);
}

interface IHintHelpers {
    function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed)
        external
        view
        returns (address hintAddress, uint256 diff, uint256 latestRandomSeed);
    function computeNominalCR(uint256 _coll, uint256 _debt) external pure returns (uint256);
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

/// @dev Mezo BorrowerOperationsSignatures (testnet proxy 0xD757e3646AF370b15f32EB557F0F8380Df7D639e,
///      implementation 0xEec635aB00463A4a803DE38C9d858A0FE3bdc235, explorer-verified, source = mezo-org/musd commit da7888a).
///      repayMUSDWithSignature selector 0x2cf63a40 confirmed in deployed bytecode (2026-11-14).
///      EIP-712 domain ("BorrowerOperationsSignatures", "1", chainid, proxy);
///      type RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline).
///      Mezo burns the MUSD from msg.sender (the caller), not from the borrower.
interface IBorrowerOperationsSignatures {
    function repayMUSDWithSignature(
        uint256 _amount,
        address _upperHint,
        address _lowerHint,
        address _borrower,
        bytes memory _signature,
        uint256 _deadline
    ) external;
    function getNonce(address user) external view returns (uint256);
    function borrowerOperations() external view returns (address);
}
