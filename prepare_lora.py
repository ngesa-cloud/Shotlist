"""
Framecraft Dataset Preparation Script — Center-Crop 1024x1024 & BLIP Auto-Captioning
Requires: pip install Pillow transformers torch torchvision

Usage:
  python prepare_lora.py --raw-dir ./lora_raw --output-dir ./lora_processed --trigger-word ohwx_model
"""

import argparse
import os
import sys
from PIL import Image
from transformers import BlipForConditionalGeneration, BlipProcessor

SUPPORTED_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare and BLIP-caption a LoRA dataset.")
    parser.add_argument("--raw-dir", default=os.environ.get("LORA_RAW_DIR", "./lora_raw"))
    parser.add_argument(
        "--output-dir", default=os.environ.get("LORA_PROCESSED_DIR", "./lora_processed")
    )
    parser.add_argument(
        "--trigger-word", default=os.environ.get("LORA_TRIGGER_WORD", "ohwx_model")
    )
    parser.add_argument("--size", type=int, default=1024)
    return parser.parse_args()


def process_images(raw_dir: str, processed_dir: str, trigger_word: str, target_size: int = 1024) -> int:
    if not os.path.isdir(raw_dir):
        print(f"Error: Raw dataset directory '{raw_dir}' does not exist.", file=sys.stderr)
        return 0

    candidates = sorted(
        f for f in os.listdir(raw_dir) if f.lower().endswith(SUPPORTED_EXTENSIONS)
    )
    if not candidates:
        print(
            f"Error: No images (.png, .jpg, .jpeg, .webp) found in '{raw_dir}'.",
            file=sys.stderr,
        )
        return 0

    os.makedirs(processed_dir, exist_ok=True)

    print("Loading BLIP captioning model (Salesforce/blip-image-captioning-base)...")
    processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")

    processed_count = 0
    for filename in candidates:
        img_path = os.path.join(raw_dir, filename)
        try:
            # 1. Process Image (Center-crop square and resize to target_size x target_size)
            img = Image.open(img_path).convert("RGB")
            width, height = img.size
            min_dim = min(width, height)
            left = (width - min_dim) / 2
            top = (height - min_dim) / 2
            right = (width + min_dim) / 2
            bottom = (height + min_dim) / 2
            img = img.crop((left, top, right, bottom)).resize(
                (target_size, target_size), Image.LANCZOS
            )

            base_name = os.path.splitext(filename)[0]
            out_img_path = os.path.join(processed_dir, f"{base_name}.png")
            img.save(out_img_path)

            # 2. Generate Caption
            inputs = processor(img, return_tensors="pt")
            out = model.generate(**inputs, max_length=50)
            raw_caption = processor.decode(out[0], skip_special_tokens=True).strip()

            # 3. Write Caption File (Prepend unique trigger word)
            caption = f"{trigger_word}, {raw_caption}"
            with open(os.path.join(processed_dir, f"{base_name}.txt"), "w", encoding="utf-8") as f:
                f.write(caption)

            processed_count += 1
            print(f"[{processed_count}/{len(candidates)}] Processed: {filename} -> {caption}")
        except Exception as exc:
            print(f"Failed to process {filename}: {exc}", file=sys.stderr)

    return processed_count


if __name__ == "__main__":
    args = parse_args()
    count = process_images(args.raw_dir, args.output_dir, args.trigger_word, args.size)
    if count == 0:
        sys.exit(1)
    print(f"Dataset prep complete ({count} images). Ready for training.")
