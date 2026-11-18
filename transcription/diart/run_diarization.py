import argparse
from pathlib import Path

from diart import SpeakerDiarization
from diart.sources import FileAudioSource
from diart.inference import StreamingInference
from diart.sinks import RTTMWriter


def main():
    parser = argparse.ArgumentParser(
        description="Run MICAWS speaker diarization"
    )

    parser.add_argument(
        "audio",
        help="Path to input audio file"
    )

    parser.add_argument(
        "output",
        help="Path to output RTTM file"
    )

    args = parser.parse_args()

    audio = Path(args.audio)
    output = Path(args.output)

    if not audio.is_file():
        parser.error(f"Audio file not found: {audio}")

    output.parent.mkdir(parents=True, exist_ok=True)

    print("Loading diart models...", flush=True)

    pipeline = SpeakerDiarization()

    source = FileAudioSource(
        str(audio),
        sample_rate=pipeline.config.sample_rate
    )

    inference = StreamingInference(
        pipeline,
        source,
        do_plot=False
    )

    inference.attach_observers(
        RTTMWriter(source.uri, str(output))
    )

    print("Running speaker diarization...", flush=True)

    inference()

    print("DONE!", flush=True)
    print(f"Results saved to {output}", flush=True)


if __name__ == "__main__":
    main()
