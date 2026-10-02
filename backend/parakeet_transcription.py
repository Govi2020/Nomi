from io import BytesIO
import threading
import wave

import numpy as np

MODEL_ID = "nvidia/parakeet-tdt-0.6b-v3"
SAMPLE_RATE = 16_000

_model_lock = threading.Lock()
_processor = None
_model = None
_torch = None


class ParakeetUnavailableError(RuntimeError):
    pass


def prepare_model():
    global _model, _processor, _torch

    with _model_lock:
        if _model is not None and _processor is not None:
            return

        try:
            import torch
            from transformers import AutoModelForTDT, AutoProcessor
        except ImportError as exc:
            raise ParakeetUnavailableError(
                "Parakeet needs the backend's torch and transformers dependencies."
            ) from exc

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        dtype = torch.float16 if device.type == "cuda" else torch.float32
        try:
            processor = AutoProcessor.from_pretrained(MODEL_ID)
            model = AutoModelForTDT.from_pretrained(MODEL_ID, dtype=dtype)
            model.to(device)
            model.eval()
        except (ImportError, OSError, RuntimeError, ValueError) as exc:
            raise ParakeetUnavailableError(
                "Could not load Parakeet from Hugging Face. Check the connection, "
                "available memory, and model cache, then try again."
            ) from exc

        _torch = torch
        _processor = processor
        _model = model


def _decode_wav(contents: bytes) -> np.ndarray:
    try:
        with wave.open(BytesIO(contents), "rb") as audio:
            if audio.getcomptype() != "NONE" or audio.getsampwidth() != 2:
                raise ValueError("Talk audio must be an uncompressed 16-bit PCM WAV.")
            if audio.getframerate() != SAMPLE_RATE:
                raise ValueError(f"Talk audio must be sampled at {SAMPLE_RATE} Hz.")
            if audio.getnframes() == 0 or audio.getnframes() > SAMPLE_RATE * 40:
                raise ValueError("Talk audio must be between 0 and 40 seconds long.")

            channels = audio.getnchannels()
            samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2")
            if channels > 1:
                samples = samples.reshape(-1, channels).mean(axis=1)
    except wave.Error as exc:
        raise ValueError("Talk audio must be a valid WAV file.") from exc

    return samples.astype(np.float32) / 32768.0


def transcribe_wav(contents: bytes) -> str:
    samples = _decode_wav(contents)
    prepare_model()

    with _model_lock:
        inputs = _processor(
            audio=samples,
            sampling_rate=SAMPLE_RATE,
            return_tensors="pt",
        )
        inputs.to(_model.device, dtype=_model.dtype)
        with _torch.inference_mode():
            output = _model.generate(
                **inputs,
                max_new_tokens=256,
                return_dict_in_generate=True,
            )
        text = _processor.decode(output.sequences, skip_special_tokens=True)
        if isinstance(text, list):
            return " ".join(part.strip() for part in text if part.strip())
        return text.strip()
