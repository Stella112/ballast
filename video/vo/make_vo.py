"""Generate the voiceover with Microsoft Edge TTS (voice used for TrustBook: en-US-AndrewMultilingualNeural)
and write src/timeline.json with per-scene audio length and caption timings taken from the TTS word timings.
Each line is validated (all words spoken) and cached in vo/cache/<id>.json so a flaky connection only costs retries.
Usage: python vo/make_vo.py   (run from video/)"""
import asyncio, hashlib, json, os, re, subprocess
import edge_tts

VOICE = "en-US-AndrewMultilingualNeural"
FPS = 30
PAD_BEFORE = 10   # frames of silence before each scene's audio
PAD_AFTER = 14    # frames after


async def _synth(item, out):
    com = edge_tts.Communicate(item["say"], VOICE, boundary="WordBoundary", connect_timeout=20, receive_timeout=40)
    words = []
    with open(out, "wb") as f:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append([chunk["offset"] / 1e7, (chunk["offset"] + chunk["duration"]) / 1e7, chunk["text"]])
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).decode().strip())
    expected = len(re.findall(r"[A-Za-z0-9']+", item["say"]))
    last = words[-1][1] if words else 0
    if len(words) < expected * 0.85 or dur < last - 0.3:
        raise RuntimeError(f"incomplete audio: {len(words)}/{expected} words, {dur:.1f}s vs last word at {last:.1f}s")
    return dur, words


async def synth(item):
    os.makedirs("vo/cache", exist_ok=True)
    out = f"public/{item['id']}.mp3"
    key = hashlib.sha1((VOICE + item["say"]).encode()).hexdigest()
    cache = f"vo/cache/{item['id']}.json"
    if os.path.exists(cache) and os.path.exists(out):
        c = json.load(open(cache))
        if c["key"] == key:
            return c["dur"], c["words"]
    for attempt in range(8):
        try:
            dur, words = await asyncio.wait_for(_synth(item, out), timeout=120)
            json.dump({"key": key, "dur": dur, "words": words}, open(cache, "w"))
            return dur, words
        except Exception as e:
            print("retry", item["id"], type(e).__name__, str(e)[:90], flush=True)
            await asyncio.sleep(2)
    raise SystemExit("TTS failed for " + item["id"])


def caption_times(item, dur, words):
    """Each caption starts at the first spoken word of its share of the line and lasts until the next begins."""
    caps = item["captions"]
    total = sum(len(c) for c in caps)
    n = len(words)
    starts, acc = [], 0
    for c in caps:
        idx = min(n - 1, round(n * acc / total))
        starts.append(words[idx][0])
        acc += len(c)
    return [[starts[i], starts[i + 1] if i + 1 < len(caps) else dur] for i in range(len(caps))]


async def main():
    lines = json.load(open("vo/lines.json", encoding="utf-8"))
    scenes, cursor = [], 0
    for item in lines:
        dur, words = await synth(item)
        af = round(dur * FPS)
        caps = [{"from": round(a * FPS), "to": round(b * FPS), "text": t} for (a, b), t in zip(caption_times(item, dur, words), item["captions"])]
        scenes.append({"id": item["id"], "start": cursor + PAD_BEFORE, "audioFrames": af, "len": PAD_BEFORE + af + PAD_AFTER, "from": cursor, "captions": caps})
        cursor += PAD_BEFORE + af + PAD_AFTER
        print(f"{item['id']:8s} {dur:6.2f}s words={len(words)}", flush=True)
    json.dump({"fps": FPS, "total": cursor, "voice": VOICE, "scenes": scenes}, open("src/timeline.json", "w", encoding="utf-8"), indent=1)
    print("total", round(cursor / FPS, 1), "s", flush=True)


asyncio.run(main())
