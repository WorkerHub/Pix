import os
import sys
import tempfile
from unittest.mock import MagicMock, patch

import pytest
import torch
from safetensors.torch import load_file, save_file

from machine.merge_lora import main, merge_lora_to_checkpoint


def test_merge_lora_file_not_found():
    with tempfile.TemporaryDirectory() as tmp_dir:
        base_path = os.path.join(tmp_dir, "base.safetensors")
        lora_path = os.path.join(tmp_dir, "lora.safetensors")
        out_path = os.path.join(tmp_dir, "out.safetensors")

        # Base missing
        with pytest.raises(FileNotFoundError, match="Base checkpoint not found"):
            merge_lora_to_checkpoint(base_path, lora_path, out_path)

        # Base exists, LoRA missing
        with open(base_path, "wb") as f:
            f.write(b"base")
        with pytest.raises(FileNotFoundError, match="LoRA file not found"):
            merge_lora_to_checkpoint(base_path, lora_path, out_path)


def test_merge_lora_success_mocked():
    with tempfile.TemporaryDirectory() as tmp_dir:
        base_path = os.path.join(tmp_dir, "base.safetensors")
        lora_path = os.path.join(tmp_dir, "lora.safetensors")
        out_path = os.path.join(tmp_dir, "out.safetensors")

        with open(base_path, "wb") as f:
            f.write(b"base")
        with open(lora_path, "wb") as f:
            f.write(b"lora")

        mock_comfy = MagicMock()
        mock_utils = MagicMock()
        mock_lora = MagicMock()
        mock_lora_convert = MagicMock()
        mock_model_detection = MagicMock()

        mock_comfy.utils = mock_utils
        mock_comfy.lora = mock_lora
        mock_comfy.lora_convert = mock_lora_convert
        mock_comfy.model_detection = mock_model_detection

        base_sd = {
            "model.diffusion_model.input_blocks.1.1.transformer_blocks.0.attn1.to_q.weight": MagicMock(),
        }
        mock_utils.load_torch_file.side_effect = [
            (base_sd, {"modelspec.predict_key": "epsilon"}),
            {"lora_key": "dummy"},
        ]
        mock_lora_convert.convert_lora.return_value = {"lora_key": "dummy"}
        mock_model_detection.unet_prefix_from_state_dict.return_value = "model.diffusion_model."
        mock_model_detection.model_config_from_unet.return_value = None

        mock_adapter = MagicMock()
        mock_adapter.calculate_weight.return_value = "patched_weight"
        mock_lora.load_lora.return_value = {
            "model.diffusion_model.input_blocks.1.1.transformer_blocks.0.attn1.to_q.weight": mock_adapter
        }

        def fake_save_torch_file(sd, path, metadata=None):
            with open(path, "wb") as f:
                f.write(b"merged_checkpoint_bytes")

        mock_utils.save_torch_file = fake_save_torch_file

        modules = {
            "comfy": mock_comfy,
            "comfy.utils": mock_utils,
            "comfy.lora": mock_lora,
            "comfy.lora_convert": mock_lora_convert,
            "comfy.model_detection": mock_model_detection,
            "torch": MagicMock(),
        }

        with patch.dict(sys.modules, modules):
            merge_lora_to_checkpoint(base_path, lora_path, out_path, strength=1.0)

        assert os.path.isfile(out_path)
        with open(out_path, "rb") as f:
            assert f.read() == b"merged_checkpoint_bytes"
        assert not os.path.exists(out_path + ".tmp")


def test_merge_lora_inplace_real_tensors():
    """验证真实张量计算：LoRA 权重精确原地打入，并且 CLIP 和 VAE 权重完好保留。"""
    with tempfile.TemporaryDirectory() as tmp_dir:
        base_path = os.path.join(tmp_dir, "base.safetensors")
        lora_path = os.path.join(tmp_dir, "lora.safetensors")
        out_path = os.path.join(tmp_dir, "out.safetensors")

        target_layer = "model.diffusion_model.input_blocks.1.1.transformer_blocks.0.attn1.to_q.weight"
        orig_weight = torch.randn(320, 320, dtype=torch.float16)

        base_tensors = {
            "model.diffusion_model.input_blocks.0.0.weight": torch.randn(320, 4, 3, 3, dtype=torch.float16),
            "model.diffusion_model.out.2.weight": torch.randn(4, 320, 3, 3, dtype=torch.float16),
            target_layer: orig_weight.clone(),
            "cond_stage_model.transformer.text_model.encoder.layers.0.mlp.fc1.weight": torch.randn(3072, 768, dtype=torch.float16),
            "first_stage_model.decoder.conv_in.weight": torch.randn(512, 4, 3, 3, dtype=torch.float16),
        }
        save_file(base_tensors, base_path)

        down_w = torch.randn(16, 320, dtype=torch.float16)
        up_w = torch.randn(320, 16, dtype=torch.float16)
        lora_tensors = {
            "down_blocks.0.attentions.0.transformer_blocks.0.attn1.to_q.lora.down.weight": down_w,
            "down_blocks.0.attentions.0.transformer_blocks.0.attn1.to_q.lora.up.weight": up_w,
            "down_blocks.0.attentions.0.transformer_blocks.0.attn1.to_q.alpha": torch.tensor(16.0),
        }
        save_file(lora_tensors, lora_path)

        merge_lora_to_checkpoint(base_path, lora_path, out_path, strength=1.0)

        assert os.path.isfile(out_path)
        merged_tensors = load_file(out_path)

        # 检查 UNet 目标层被正确合并修改
        assert target_layer in merged_tensors
        merged_w = merged_tensors[target_layer]
        diff_norm = (merged_w.float() - orig_weight.float()).norm().item()
        assert diff_norm > 0.1

        # 检查 CLIP 与 VAE 完好保留未被破坏
        assert "cond_stage_model.transformer.text_model.encoder.layers.0.mlp.fc1.weight" in merged_tensors
        assert "first_stage_model.decoder.conv_in.weight" in merged_tensors
        assert not os.path.exists(out_path + ".tmp")


def test_merge_lora_main_cli():
    with tempfile.TemporaryDirectory() as tmp_dir:
        base_path = os.path.join(tmp_dir, "base.safetensors")
        lora_path = os.path.join(tmp_dir, "lora.safetensors")
        out_path = os.path.join(tmp_dir, "out.safetensors")

        with open(base_path, "wb") as f:
            f.write(b"base")
        with open(lora_path, "wb") as f:
            f.write(b"lora")

        test_args = [
            "merge_lora.py",
            "--base-path",
            base_path,
            "--lora-path",
            lora_path,
            "--output-path",
            out_path,
            "--strength",
            "0.8",
        ]

        with (
            patch.object(sys, "argv", test_args),
            patch("machine.merge_lora.merge_lora_to_checkpoint") as mock_merge,
        ):
            main()
            mock_merge.assert_called_once_with(
                base_checkpoint_path=base_path,
                lora_path=lora_path,
                output_path=out_path,
                strength=0.8,
            )
