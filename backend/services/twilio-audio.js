/**
 * Twilio Media Streams audio — mulaw 8kHz encode + chunked outbound frames.
 * Twilio expects base64 mulaw payloads (~160 bytes / 20ms at 8kHz mono).
 */

const MULAW_MAX = 8191;

function linearToMulaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let s = sample;
  let sign = 0;
  if (s < 0) {
    sign = 0x80;
    s = -s;
  }
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (s & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function pcm16ToMulaw(pcmBuffer) {
  const out = Buffer.alloc(pcmBuffer.length / 2);
  for (let i = 0; i < out.length; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    out[i] = linearToMulaw(sample);
  }
  return out;
}

function resamplePcm16(pcm, fromRate, toRate) {
  if (fromRate === toRate) return pcm;
  const inSamples = pcm.length / 2;
  const outSamples = Math.max(1, Math.floor(inSamples * toRate / fromRate));
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcIdx = Math.min(inSamples - 1, Math.floor(i * fromRate / toRate));
    out.writeInt16LE(pcm.readInt16LE(srcIdx * 2), i * 2);
  }
  return out;
}

function parseWavPcm(wavBuffer) {
  if (!wavBuffer || wavBuffer.length < 44) return null;
  if (wavBuffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  const audioFormat = wavBuffer.readUInt16LE(20);
  const channels = wavBuffer.readUInt16LE(22);
  const sampleRate = wavBuffer.readUInt32LE(24);
  let offset = 12;
  while (offset + 8 <= wavBuffer.length) {
    const id = wavBuffer.toString('ascii', offset, offset + 4);
    const size = wavBuffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === 'data') {
      let pcm = wavBuffer.slice(dataStart, dataStart + size);
      if (channels === 2) {
        const mono = Buffer.alloc(pcm.length / 2);
        for (let i = 0; i < mono.length; i += 2) {
          mono.writeInt16LE(pcm.readInt16LE(i * 2), i);
        }
        pcm = mono;
      }
      if (audioFormat === 1) {
        return { pcm, sampleRate };
      }
    }
    offset = dataStart + size + (size % 2);
  }
  return null;
}

function wavOrPcmToMulaw8k(audioBuffer) {
  if (!audioBuffer || !audioBuffer.length) return null;
  if (audioBuffer.slice(0, 4).toString('ascii') === 'RIFF') {
    const parsed = parseWavPcm(audioBuffer);
    if (!parsed) return null;
    const pcm8k = resamplePcm16(parsed.pcm, parsed.sampleRate, 8000);
    return pcm16ToMulaw(pcm8k);
  }
  // Already raw mulaw
  if (audioBuffer.length >= 160 && audioBuffer.length % 160 === 0) {
    return audioBuffer;
  }
  return null;
}

/** 160 bytes = 20ms @ 8kHz mulaw */
function chunkMulaw(mulawBuffer, frameSize) {
  const size = frameSize || 160;
  const frames = [];
  for (let i = 0; i < mulawBuffer.length; i += size) {
    frames.push(mulawBuffer.slice(i, i + size));
  }
  return frames;
}

function sendMulawStream(ws, streamSid, mulawBuffer, opts) {
  if (!ws || ws.readyState !== 1 || !mulawBuffer || !mulawBuffer.length) return;
  const options = opts || {};
  if (options.clearFirst) {
    ws.send(JSON.stringify({ event: 'clear', streamSid }));
  }
  const frames = chunkMulaw(mulawBuffer, options.frameSize || 160);
  for (const frame of frames) {
    ws.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: frame.toString('base64') }
    }));
  }
}

/** Simple energy-based silence on mulaw buffer (last N bytes) */
function mulawEnergy(mulawChunk) {
  if (!mulawChunk || !mulawChunk.length) return 0;
  let sum = 0;
  for (let i = 0; i < mulawChunk.length; i++) {
    const u = mulawChunk[i];
    sum += Math.abs(u - 128);
  }
  return sum / mulawChunk.length;
}

module.exports = {
  pcm16ToMulaw,
  wavOrPcmToMulaw8k,
  chunkMulaw,
  sendMulawStream,
  mulawEnergy,
  parseWavPcm,
  resamplePcm16
};
