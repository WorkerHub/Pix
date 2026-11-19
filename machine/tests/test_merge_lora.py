import os
import sys
import tempfile
from unittest.mock import MagicMock, patch

import pytest

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


def test_merge_lora_success():
    with tempfile.TemporaryDirectory() as tmp_dir:
        base_path = os.path.join(tmp_dir, "base.safetensors")
        lora_path = os.path.join(tmp_dir, "lora.safetensors")
        out_path = os.path.join(tmp_dir, "out.safetensors")

        with open(base_path, "wb") as f:
            f.write(b"base")
        with open(lora_path, "wb") as f:
            f.write(b"lora")

        # Mock comfy modules
        mock_comfy = MagicMock()
        mock_sd = MagicMock()
        mock_utils = MagicMock()
        mock_options = MagicMock()
        mock_model_base = MagicMock()
        mock_model_sampling = MagicMock()

        class DummyModelSamplingContinuousEDM:
            pass

        mock_model_sampling.ModelSamplingContinuousEDM = DummyModelSamplingContinuousEDM

        mock_comfy.sd = mock_sd
        mock_comfy.utils = mock_utils
        mock_comfy.options = mock_options
        mock_comfy.model_base = mock_model_base
        mock_comfy.model_sampling = mock_model_sampling

        mock_model = MagicMock()
        mock_clip = MagicMock()
        mock_vae = MagicMock()
        mock_sd.load_checkpoint_guess_config.return_value = (mock_model, mock_clip, mock_vae, None)

        mock_lora_dict = {"lora_key": "dummy"}
        mock_utils.load_torch_file.return_value = mock_lora_dict

        mock_model_lora = MagicMock()
        mock_model_lora.model.model_type = "eps"
        mock_model_lora.get_model_object.return_value = None
        mock_clip_lora = MagicMock()
        mock_sd.load_lora_for_models.return_value = (mock_model_lora, mock_clip_lora)

        def fake_save_checkpoint(path, model, clip=None, vae=None, clip_vision=None, metadata=None, extra_keys=None):
            with open(path, "wb") as f:
                f.write(b"merged_checkpoint_bytes")

        mock_sd.save_checkpoint = fake_save_checkpoint

        modules = {
            "comfy": mock_comfy,
            "comfy.options": mock_options,
            "comfy.model_base": mock_model_base,
            "comfy.model_management": MagicMock(),
            "comfy.model_sampling": mock_model_sampling,
            "comfy.sd": mock_sd,
            "comfy.utils": mock_utils,
            "torch": MagicMock(),
        }

        with patch.dict(sys.modules, modules):
            merge_lora_to_checkpoint(base_path, lora_path, out_path, strength=1.0)

        assert os.path.isfile(out_path)
        with open(out_path, "rb") as f:
            assert f.read() == b"merged_checkpoint_bytes"
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
