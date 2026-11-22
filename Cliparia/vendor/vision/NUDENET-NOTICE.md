# NudeNet 320n

Unmodified model from notAI-tech/NudeNet, v3 branch, 320n model (v3.4 weights).

Source: https://github.com/notAI-tech/NudeNet/tree/v3
Model: https://raw.githubusercontent.com/notAI-tech/NudeNet/v3/nudenet/320n.onnx
SHA-256: c15d8273adad2d0a92f014cc69ab2d6c311a06777a55545f2c4eb46f51911f0f

Upstream license: GNU Affero General Public License v3.0; see LICENSE-NUDENET.txt.
Upstream preprocessing and class definitions are documented in nudenet/nudenet.py.
The Cliparia adapter samples video locally using FFmpeg and runs the unmodified
ONNX model using the existing ONNX Runtime Web distribution in this directory.

The model is probabilistic. Sampling may miss brief scenes and predictions can
be incorrect. An approved result means no configured signal was detected in
the sampled frames and available text; it is not a certification of the video.
