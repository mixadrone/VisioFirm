import torch

print(f"CUDA available: {torch.cuda.is_available()}")
print(f"Current device: {torch.cuda.get_device_name(0)}")
print(f"CUDA capability: {torch.cuda.get_device_capability(0)}")
# Ця команда спробує виконати просте обчислення
try:
    print(torch.ones(1).cuda() + 1)
    print("GPU test passed!")
except Exception as e:
    print(f"GPU test failed: {e}")
