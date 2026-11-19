import argparse
import gc
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pix-service.merge_lora")


def build_lora_key_map(base_sd: dict, prefix: str, model_config=None) -> dict[str, str]:
    """构建 LoRA 键名到 Base Checkpoint 状态字典键名的映射表。

    支持 generic 格式、diffusers 格式与 LyCORIS/Kohya 格式。
    在 state_dict 级别就地运算，避免实例化 PyTorch 模型或 ModelPatcher 产生全量内存冗余。
    """
    import comfy.utils

    key_map: dict[str, str] = {}

    # 1. 基础 direct 映射与 unet 前缀剥离映射
    for k in list(base_sd.keys()):
        if k.startswith(prefix):
            unet_k = k[len(prefix):]
            if unet_k.endswith(".weight"):
                key_lora = unet_k[:-len(".weight")].replace(".", "_")
                key_map[f"lora_unet_{key_lora}"] = k
                key_map[unet_k[:-len(".weight")]] = k
            else:
                key_map[unet_k] = k
        if k.endswith(".weight"):
            key_lora = k[:-len(".weight")].replace(".", "_")
            key_map[f"lora_unet_{key_lora}"] = k
            key_map[k[:-len(".weight")]] = k
            key_map[k] = k

    # 2. Diffusers 格式映射（LCM-LoRA 官方发布的 diffusers 权重格式）
    unet_config = getattr(model_config, "unet_config", None)
    if unet_config is None:
        unet_config = {
            "num_res_blocks": [2, 2, 2, 2],
            "channel_mult": [1, 2, 4, 4],
            "transformer_depth": [1, 1, 1, 1, 1, 1, 0, 0],
            "transformer_depth_output": [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
            "transformer_depth_middle": 1,
        }

    try:
        diffusers_keys = comfy.utils.unet_to_diffusers(unet_config)
        for k, v in diffusers_keys.items():
            if k.endswith(".weight"):
                unet_key = f"{prefix}{v}"
                key_lora = k[:-len(".weight")].replace(".", "_")
                key_map[f"lora_unet_{key_lora}"] = unet_key
                key_map[f"lycoris_{key_lora}"] = unet_key

                stem = k[:-len(".weight")]
                for p in ["", "unet."]:
                    to_proc = stem.replace(".to_", ".processor.to_")
                    if to_proc.endswith(".to_out.0"):
                        to_proc = to_proc[:-2]
                    key_map[f"{p}{to_proc}"] = unet_key

                    stem_key = stem
                    if stem_key.endswith(".to_out.0"):
                        stem_key = stem_key[:-2]
                    key_map[f"{p}{stem_key}"] = unet_key
    except Exception as e:
        logger.warning(f"Could not build diffusers key mapping: {e}")

    return key_map


def merge_lora_to_checkpoint(
    base_checkpoint_path: str,
    lora_path: str,
    output_path: str,
    strength: float = 1.0,
) -> None:
    """低内存原地（in-place）合并 LoRA 到基座 checkpoint。

    不通过 ModelPatcher 或全量 nn.Module，直接在 state_dict 级别就地运算：
    weight += (strength * alpha / rank) * (lora_up @ lora_down)
    合并后原子替换写入目标文件，避免子进程瞬时 RSS 触及 7.8GB 触发 OOMKilled。
    """
    if not os.path.isfile(base_checkpoint_path):
        raise FileNotFoundError(f"Base checkpoint not found: {base_checkpoint_path}")
    if not os.path.isfile(lora_path):
        raise FileNotFoundError(f"LoRA file not found: {lora_path}")

    # Ensure ComfyUI directory is in sys.path
    candidate_dirs = [
        os.getenv("COMFYUI_DIR"),
        "/app/ComfyUI",
        "/tmp/comfyui-inspect",
    ]
    for d in candidate_dirs:
        if d and os.path.isdir(d) and d not in sys.path:
            sys.path.insert(0, d)
            break

    # Force CPU device mode for ComfyUI without polluting CLI args
    try:
        import comfy.cli_args

        comfy.cli_args.args = comfy.cli_args.parser.parse_args(["--cpu"])
    except Exception as e:
        logger.warning(f"Failed to set ComfyUI cpu cli args: {e}")

    import comfy.lora
    import comfy.lora_convert
    import comfy.model_detection
    import comfy.utils

    logger.info(f"Loading base checkpoint state dict from {base_checkpoint_path}...")
    base_res = comfy.utils.load_torch_file(
        base_checkpoint_path, safe_load=True, return_metadata=True
    )
    if isinstance(base_res, tuple) and len(base_res) == 2:
        base_sd, metadata = base_res
    else:
        base_sd, metadata = base_res, {}
    if metadata is None:
        metadata = {}

    logger.info(f"Loading LoRA weights from {lora_path}...")
    lora_sd = comfy.utils.load_torch_file(lora_path, safe_load=True)
    lora_sd = comfy.lora_convert.convert_lora(lora_sd)

    prefix = comfy.model_detection.unet_prefix_from_state_dict(base_sd)
    if prefix == "model." and any(k.startswith("model.diffusion_model.") for k in base_sd):
        prefix = "model.diffusion_model."

    model_config = comfy.model_detection.model_config_from_unet(base_sd, prefix)
    key_map = build_lora_key_map(base_sd, prefix, model_config)

    logger.info("Matching LoRA keys against checkpoint keys...")
    loaded = comfy.lora.load_lora(lora_sd, key_map)
    logger.info(f"Matched {len(loaded)} layers to merge into base checkpoint.")

    # 逐层就地计算并打入权重，避免同时复制多份完整 UNet
    patched_count = 0
    for target_key, adapter in loaded.items():
        if target_key in base_sd:
            base_sd[target_key] = adapter.calculate_weight(
                base_sd[target_key],
                target_key,
                strength=strength,
                strength_model=strength,
                offset=0,
                function=lambda x: x,
            )
            patched_count += 1
        else:
            logger.warning(f"Target key {target_key} not found in base checkpoint.")

    logger.info(f"Successfully patched {patched_count} layers in-place.")

    # 释放 LoRA 与映射表临时引用，保持内存极简
    del loaded, lora_sd, key_map
    gc.collect()

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    tmp_output = output_path + ".tmp"
    if os.path.exists(tmp_output):
        os.remove(tmp_output)

    try:
        logger.info(f"Saving merged checkpoint to temporary file {tmp_output}...")
        comfy.utils.save_torch_file(base_sd, tmp_output, metadata=metadata)
        del base_sd
        gc.collect()

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
        description="Offline low-memory in-place merge LoRA weights into SD checkpoint"
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
