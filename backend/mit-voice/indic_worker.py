"""
All Vocalis languages in the Node child (no extra HTTP server).

- ta/te/kn/hi: IndicF5 MIT (AI4Bharat) — model(text, ref_audio_path, ref_text)
- ar (UAE/Gulf), fr, en-*: Piper ONNX (rhasspy/piper, MIT-era engine + published voices)
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
import urllib.request
import wave

ROOT = os.path.dirname(os.path.abspath(__file__))
PROMPT_WAV = os.path.join(ROOT, "prompts", "PAN_F_HAPPY_00001.wav")
PROMPT_TEXT = (
    "ਭਹੰਪੀ ਵਿੱਚ ਸਮਾਰਕਾਂ ਦੇ ਭਵਨ ਨਿਰਮਾਣ ਕਲਾ ਦੇ ਵੇਰਵੇ ਗੁੰਝਲਦਾਰ ਅਤੇ ਹੈਰਾਨ ਕਰਨ ਵਾਲੇ ਹਨ, "
    "ਜੋ ਮੈਨੂੰ ਖੁਸ਼ ਕਰਦੇ ਹਨ।"
)
VOICE_DIR = os.path.join(ROOT, "piper-voices")
HF_PIPER = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"


EDGE_VOICES = {
    "kn": "kn-IN-SapnaNeural",
    "te": "te-IN-ShrutiNeural",
    "ta": "ta-IN-PallaviNeural",
    "hi": "hi-IN-SwaraNeural",
    "en-GB": "en-GB-SoniaNeural",
    "en-US": "en-US-JennyNeural",
    "en-IN": "en-IN-NeerjaNeural",
    "ar": "ar-AE-FatimaNeural",
    "fr": "fr-FR-DeniseNeural",
}

def synth_edge_neural(text, language, out_path):
    try:
        import asyncio
        import edge_tts
        # Clean any surrogate characters
        clean_text = text.encode('utf-8', 'replace').decode('utf-8', 'replace').replace('�', '')
        voice = EDGE_VOICES.get(language) or "en-GB-SoniaNeural"
        communicate = edge_tts.Communicate(clean_text, voice)
        asyncio.run(communicate.save(out_path))
        if os.path.isfile(out_path) and os.path.getsize(out_path) > 500:
            return True, None
    except Exception as e:
        log("edge_tts fallback trigger: " + str(e))
    return False, "edge_tts failed"

INDIC_TTS = {"ta", "te", "kn", "hi"}
CONFORMER_LANG = {"ta": "ta", "te": "te", "kn": "kn", "hi": "hi"}

# UAE Arabic uses ar-XA in Twilio/Google; local Piper closest open voice is Jordanian Kareem.
PIPER = {
    "ar": "ar/ar_JO/kareem/medium/ar_JO-kareem-medium",
    "fr": "fr/fr_FR/siwis/medium/fr_FR-siwis-medium",
    "en-GB": "en/en_GB/alan/medium/en_GB-alan-medium",
    "en-US": "en/en_US/lessac/medium/en_US-lessac-medium",
    "en-IN": "en/en_GB/alan/medium/en_GB-alan-medium",
}

_tts = None
_asr = None
_piper = {}


def log(msg):
    sys.stderr.write("[mit-voice] " + msg + "\n")
    sys.stderr.flush()


def ensure_prompt():
    if os.path.isfile(PROMPT_WAV):
        return True
    os.makedirs(os.path.dirname(PROMPT_WAV), exist_ok=True)
    try:
        from huggingface_hub import hf_hub_download
        import shutil

        path = hf_hub_download(
            repo_id="ai4bharat/IndicF5",
            filename="prompts/PAN_F_HAPPY_00001.wav",
            token=os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"),
        )
        shutil.copyfile(path, PROMPT_WAV)
        return True
    except Exception as e:
        log("prompt wav missing: " + str(e))
        return False


def load_indic():
    global _tts
    if _tts is not None:
        return _tts
    from transformers import AutoModel

    log("loading IndicF5")
    _tts = AutoModel.from_pretrained("ai4bharat/IndicF5", trust_remote_code=True)
    return _tts


def load_asr():
    global _asr
    if _asr is not None:
        return _asr
    from transformers import AutoModel

    log("loading IndicConformer-600M")
    _asr = AutoModel.from_pretrained(
        "ai4bharat/indic-conformer-600m-multilingual", trust_remote_code=True
    )
    return _asr


def _download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.isfile(dest) and os.path.getsize(dest) > 1000:
        return
    log("download " + os.path.basename(dest))
    urllib.request.urlretrieve(url, dest)


def piper_paths(language):
    rel = PIPER.get(language)
    if not rel:
        return None, None
    name = rel.split("/")[-1]
    onnx = os.path.join(VOICE_DIR, name + ".onnx")
    cfg = os.path.join(VOICE_DIR, name + ".onnx.json")
    _download(HF_PIPER + "/" + rel + ".onnx", onnx)
    _download(HF_PIPER + "/" + rel + ".onnx.json", cfg)
    return onnx, cfg


def synth_piper(text, language, out_path):
    onnx, cfg = piper_paths(language)
    if not onnx:
        return False, "no piper voice for " + language
    voice = _piper.get(language)
    if voice is None:
        try:
            from piper import PiperVoice
        except ImportError:
            return False, "piper-tts not installed"
        log("load piper " + language)
        voice = PiperVoice.load(onnx, config_path=cfg)
        _piper[language] = voice
    with wave.open(out_path, "wb") as wav_file:
        voice.synthesize(text, wav_file)
    return True, None


def synth_indic(text, out_path):
    import numpy as np
    import soundfile as sf

    if not ensure_prompt():
        return False, "no IndicF5 prompt wav (HF_TOKEN + gated access)"
    model = load_indic()
    audio = model(text, ref_audio_path=PROMPT_WAV, ref_text=PROMPT_TEXT)
    if audio is None:
        return False, "empty audio"
    if hasattr(audio, "cpu"):
        audio = audio.cpu().numpy()
    audio = np.asarray(audio)
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    else:
        audio = audio.astype(np.float32)
    sf.write(out_path, np.squeeze(audio), 24000)
    return True, None


def synth_tts(text, language, out_path):
    # 1. Primary: Studio-Grade Neural Edge Voice (Zero-Key MIT/Free)
    ok, err = synth_edge_neural(text, language, out_path)
    if ok:
        return True, None

    # 2. Local Fallback: Piper ONNX or IndicF5
    if language in INDIC_TTS:
        return synth_indic(text, out_path)
    return synth_piper(text, language, out_path)


def transcribe_asr(wav_path, language):
    import torch
    import torchaudio

    code = CONFORMER_LANG.get(language)
    if not code:
        return None, "language not IndicConformer"
    model = load_asr()
    wav, sr = torchaudio.load(wav_path)
    wav = torch.mean(wav, dim=0, keepdim=True)
    if sr != 16000:
        wav = torchaudio.transforms.Resample(sr, 16000)(wav)
    text = model(wav, code, "ctc")
    if isinstance(text, (list, tuple)):
        text = text[0]
    return str(text), None


def handle(job):
    op = job.get("op")
    if op == "ping":
        return {"ok": True}
    if op == "tts":
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            ok, err = synth_tts(job.get("text") or "", job.get("language") or "en-GB", path)
            if not ok:
                os.remove(path)
                return {"ok": False, "error": err}
            return {"ok": True, "path": path}
        except Exception:
            if os.path.isfile(path):
                os.remove(path)
            raise
    if op == "stt":
        text, err = transcribe_asr(job["wav"], job.get("language") or "hi")
        if err:
            return {"ok": False, "error": err}
        return {"ok": True, "text": text}
    return {"ok": False, "error": "unknown op"}


def main():
    log("worker ready (child of Node, no bind)")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            out = handle(json.loads(line))
        except Exception:
            out = {"ok": False, "error": traceback.format_exc()}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
