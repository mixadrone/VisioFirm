from ultralytics import YOLO

model = YOLO("defects_small-5.pt")
assert len(model.names) == 1, model.names

model.model.names = {0: "diode"}
model.save("_small-5-diode.pt")

print(YOLO("_small-5-diode.pt").names)