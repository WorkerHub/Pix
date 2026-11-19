import argparse
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pix-service.merge_lora")


def merge_lora_to_checkpoint(
    base_checkpoint_path: str,
    lora_path: str,
    output_path: str,
    strength: float = 1.0,
) -> None:
    if not os.path.isfile(base_checkpoint_path):
        raise FileNotFoundError(f"Base checkpoint not found: {base_checkpoint_path}")
    if not os.path.isfile(lora_path):
        raise FileNotFoundError(f"LoRA file not found: {lora_path}")

    # Ensure ComfyUI directory is in sys.path
    comfyui_dir = os.getenv("COMFYUI_DIR", "/app/ComfyUI")
    if comfyui_dir not in sys.path and os.path.isdir(comfyui_dir):
        sys.path.insert(0, comfyui_dir)

    # Force CPU device mode for ComfyUI without polluting CLI args
    try:
        import comfy.cli_args

        comfy.cli_args.args = comfy.cli_args.parser.parse_args(["--cpu"])
    except Exception as e:
        logger.warning(f"Failed to set ComfyUI cpu cli args: {e}")

    import comfy.model_base
    import comfy.model_management
    import comfy.model_sampling
    import comfy.sd
    import comfy.utils
    import torch

    logger.info(f"Loading base checkpoint from {base_checkpoint_path}...")
    model, clip, vae, clipvision = comfy.sd.load_checkpoint_guess_config(
        base_checkpoint_path,
        output_vae=True,
        output_clip=True,
        output_clipvision=False,
    )

    logger.info(f"Loading LoRA from {lora_path}...")
    lora = comfy.utils.load_torch_file(lora_path, safe_load=True)

    logger.info(f"Applying LoRA (strength={strength})...")
    model_lora, clip_lora = comfy.sd.load_lora_for_models(
        model, clip, lora, strength_model=strength, strength_clip=strength
    )

    extra_keys = {}
    model_sampling = model_lora.get_model_object("model_sampling")
    if isinstance(
        model_sampling, comfy.model_sampling.ModelSamplingContinuousEDM
    ) and isinstance(model_sampling, comfy.model_sampling.V_PREDICTION):
        extra_keys["edm_vpred.sigma_max"] = torch.tensor(
            model_sampling.sigma_max
        ).float()
        extra_keys["edm_vpred.sigma_min"] = torch.tensor(
            model_sampling.sigma_min
        ).float()

    metadata = {}
    if model_lora.model.model_type == comfy.model_base.ModelType.EPS:
        metadata["modelspec.predict_key"] = "epsilon"
    elif model_lora.model.model_type == comfy.model_base.ModelType.V_PREDICTION:
        metadata["modelspec.predict_key"] = "v"
        extra_keys["v_pred"] = torch.tensor([])
        if getattr(model_sampling, "zsnr", False):
            extra_keys["ztsnr"] = torch.tensor([])

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    tmp_output = output_path + ".tmp"
    if os.path.exists(tmp_output):
        os.remove(tmp_output)

    try:
        logger.info(f"Saving merged checkpoint to temporary file {tmp_output}...")
        comfy.sd.save_checkpoint(
            tmp_output,
            model_lora,
            clip=clip_lora,
            vae=vae,
            clip_vision=clipvision,
            metadata=metadata,
            extra_keys=extra_keys,
        )

        if not os.path.isfile(tmp_output) or os.path.getsize(tmp_output) == 0:
            raise RuntimeError(f"Merged output file is empty or missing: {tmp_output}")

        os.replace(tmp_output, output_path)
        logger.info(
            f"Merged checkpoint successfully created: {output_path} ({os.path.getsize(output_path)} bytes)"
        )
    finally:
        if os.path.exists(tmp_output):
            try:
                os.remove(tmp_output)
            except OSError:
                pass


def main():
    parser = argparse.ArgumentParser(
        description="Offline merge LoRA weights into SD checkpoint"
    )
    parser.add_argument(
        "--base-path", required=True, help="Path to base checkpoint file"
    )
    parser.add_argument("--lora-path", required=True, help="Path to LoRA file")
    parser.add_argument(
        "--output-path", required=True, help="Path to save merged checkpoint"
    )
    parser.add_argument(
        "--strength",
        type=float,
        default=1.0,
        help="LoRA merge strength (default: 1.0)",
    )
    parser.add_argument(
        "--cpu",
        action="store_true",
        default=True,
        help="Force CPU execution mode (default: True)",
    )
    args = parser.parse_args()

    merge_lora_to_checkpoint(
        base_checkpoint_path=args.base_path,
        lora_path=args.lora_path,
        output_path=args.output_path,
        strength=args.strength,
    )


if __name__ == "__main__":
    main()
