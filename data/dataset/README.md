# Detector training dataset

Expected layout (created by `python tools/train_detector.py scaffold`):

```
data.yaml
images/train/*.jpg   labels/train/*.txt
images/val/*.jpg     labels/val/*.txt
```

Each `.txt` holds one detection per line, normalised to 0-1:
`<class_id> <x_center> <y_center> <width> <height>`

Label only `building` (class 0) until the model is stable; add
road/water/vegetation classes afterwards and update `data.yaml`.

Public sources with building footprints already labelled are listed
in `models/README.md`.
