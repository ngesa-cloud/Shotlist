"""
Framecraft Kohya LoRA Training Orchestrator
Requires: kohya_ss (sd-scripts) + accelerate configured locally.

Usage:
  python train_lora.py --kohya-dir C:/kohya_ss/sd-scripts --output-name yourname_lora
"""

import argparse
import os
import subprocess
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch kohya_ss LoRA training via accelerate.")
    parser.add_argument(
        "--kohya-dir",
        default=os.environ.get("KOHYA_DIR", "C:/kohya_ss/sd-scripts"),
    )
    parser.add_argument(
        "--base-model",
        default=os.environ.get(
            "SD_BASE_MODEL",
            "C:/A1111/models/Stable-diffusion/v1-5-pruned-emaonly.safetensors",
        ),
    )
    parser.add_argument(
        "--output-dir",
        default=os.environ.get("LORA_OUTPUT_DIR", "C:/A1111/models/Lora"),
    )
    parser.add_argument(
        "--dataset-dir",
        default=os.environ.get("LORA_PROCESSED_DIR", "./lora_processed"),
    )
    parser.add_argument(
        "--output-name",
        default=os.environ.get("LORA_OUTPUT_NAME", "yourname_lora"),
    )
    parser.add_argument("--network-dim", type=int, default=32)
    parser.add_argument("--network-alpha", type=int, default=16)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--max-steps", type=int, default=1500)
    return parser.parse_args()


def train_lora(args: argparse.Namespace) -> int:
    if not os.path.isdir(args.dataset_dir):
        print(
            f"Error: {args.dataset_dir} not found. Run prepare_lora.py first.",
            file=sys.stderr,
        )
        return 1

    train_script = os.path.join(args.kohya_dir, "train_network.py")
    if not os.path.exists(train_script):
        print(
            f"Error: kohya_ss script not found at '{train_script}'. Update KOHYA_DIR or path settings.",
            file=sys.stderr,
        )
        return 1

    os.makedirs(args.output_dir, exist_ok=True)

    cmd = [
        "accelerate",
        "launch",
        train_script,
        "--pretrained_model_name_or_path",
        args.base_model,
        "--train_data_dir",
        os.path.abspath(args.dataset_dir),
        "--output_dir",
        args.output_dir,
        "--output_name",
        args.output_name,
        "--resolution",
        "512,512",
        "--network_module",
        "networks.lora",
        "--network_dim",
        str(args.network_dim),
        "--network_alpha",
        str(args.network_alpha),
        "--text_encoder_lr",
        "1e-5",
        "--unet_lr",
        "1e-4",
        "--learning_rate",
        "1e-4",
        "--lr_scheduler",
        "cosine",
        "--lr_warmup_steps",
        "0",
        "--train_batch_size",
        str(args.batch_size),
        "--max_train_steps",
        str(args.max_steps),
        "--mixed_precision",
        "fp16",
        "--save_precision",
        "fp16",
        "--save_every_n_epochs",
        "2",
        "--optimizer_type",
        "AdamW8bit",
        "--xformers",
        "--max_data_loader_n_workers",
        "0",
        "--bucket_no_upscale",
        "--shuffle_caption",
        "--keep_tokens",
        "1",
    ]

    print(f"Starting LoRA training for '{args.output_name}'...")
    try:
        process = subprocess.Popen(
            cmd,
            cwd=args.kohya_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        if process.stdout is not None:
            for line in process.stdout:
                print(line.rstrip())
        process.wait()

        if process.returncode == 0:
            print(
                f"\nTraining Complete. LoRA saved to {os.path.join(args.output_dir, args.output_name)}.safetensors"
            )
            return 0

        print("\nTraining failed. Check the Kohya/accelerate output above.", file=sys.stderr)
        return process.returncode or 1
    except Exception as exc:
        print(f"Execution error launching accelerate: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    cli_args = parse_args()
    sys.exit(train_lora(cli_args))
