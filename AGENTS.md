# AGENTS.md — VisioFirm Knowledge Base & Guidelines for AI Agents

## 1. Project Overview & Scope
**VisioFirm** is an AI-powered computer vision annotation tool and dataset management platform designed for semi-automated and fully automated labeling.
* **Primary Objective**: Rapid generation of high-quality training datasets focusing on **YOLO** (Object Detection, Oriented Bounding Box, and Instance Segmentation).
* **Key Feature**: Automatic pre-annotation using pre-trained and custom-trained models (`.pt`), zero-shot grounding (Grounding DINO, YOLO-World), and interactive segmentation (SAM2).

---

## 2. System Architecture & Project Structure

### Technology Stack
* **Backend**: FastAPI with async route handling.
* **Storage**: SQLite database per project (`<project_folder>/config.db`), file-based image and label storage.
* **AI/ML Core**: Ultralytics (YOLOv5–YOLOv12, YOLO-World), SAM2 (`sam2.1_t.pt`), Grounding DINO, OpenAI CLIP (`ViT-B/32`).
* **Cache & Weights**: `%LOCALAPPDATA%\visiofirm_cache` (Windows).

### Key Files & Modules
* `visiofirm/preannotator.py`: High-level Python API (`VFPreAnnotator`) for triggering pre-annotation jobs synchronously or in background threads.
* `visiofirm/utils/VFPreAnnotator.py`: Core inference engine (`ImageProcessor`, `PreAnnotator`), containing model loaders, IoU clustering, and database persistence.
* `visiofirm/exporter.py` & `visiofirm/utils/export_utils.py`: Dataset export pipelines for YOLO (`data.yaml`, images, labels TXT), COCO, Pascal VOC, and masks.
* `visiofirm/projects.py` & `visiofirm/models/project.py`: Project management and SQLite schema management.
* `_my_tools/`: Custom local tooling and trained models:
  * `images_to_tiles.py`: Image slicing / tiling utility for large drone/high-resolution imagery (e.g. 640x640 or 1280x1280 tiles) with overlap support.
  * `serial_numbers_260918-v1.pt`: Custom trained YOLO model for specific detection tasks.

---

## 3. Database Schema & Annotation Lifecycle

Each project maintains an independent SQLite database (`config.db`):
* `Project_Configuration`: Project metadata, `setup_type` (`Bounding Box`, `Oriented Bounding Box`, `Segmentation`, `Classification`).
* `Classes`: Class names (`class_name TEXT PRIMARY KEY`).
* `Images`: Image metadata (`image_id`, `absolute_path`, `width`, `height`).
* `Preannotations`: Auto-generated AI labels awaiting human verification:
  * Columns: `image_id`, `type`, `class_name`, `x`, `y`, `width`, `height`, `rotation`, `segmentation`, `confidence`.
* `Annotations`: Confirmed ground-truth annotations (used directly by exporters).

> **Lifecycle**:
> 1. Images uploaded & classes defined.
> 2. AI Pre-annotation runs $\rightarrow$ writes to `Preannotations`.
> 3. User reviews / edits in Web UI $\rightarrow$ saved to `Annotations`.
> 4. Export generates final YOLO dataset from `Annotations`.

---

## 4. YOLO Pre-Annotation Pipeline

### Model Ingestion & Class Matching
* **Custom Models**: Custom YOLO weights (`.pt`) loaded via Ultralytics:
  ```python
  from visiofirm.preannotator import VFPreAnnotator
  from visiofirm.projects import VFProjects

  proj = VFProjects.get_project("MyProject")
  annotator = VFPreAnnotator(
      project=proj,
      mode="custom-model",
      model_path="_my_tools/serial_numbers_260918-v1.pt",
      device="cuda",  # or 'cpu'
      box_threshold=0.25
  )
  annotator.run()
  ```
* **Class Resolution Rule**: Class names in the project (`Classes` table) must match the class names in the model's metadata (`names` dictionary in Ultralytics) case-insensitively. Unmatched detections are ignored.

### Overlap Filtering & Graph Clustering
* When `model_type == "yolo"`, `VFPreAnnotator` builds an IoU graph of overlapping bounding boxes (`IoU > 0.9`).
* Overlapping boxes with the same class take the highest confidence score.
* Overlapping boxes with conflicting classes are cropped and resolved using **OpenAI CLIP**.

---

## 5. Exporting for YOLO Training

`generate_yolo_export` produces an Ultralytics-compliant dataset:
* **Directory Structure**:
  ```text
  exported_dataset/
  ├── train/
  │   ├── images/
  │   └── labels/
  ├── val/
  │   ├── images/
  │   └── labels/
  └── data.yaml
  ```
* **Coordinates Normalization**:
  * Bounding Box: `<class_id> <x_center> <y_center> <width> <height>` (normalized $[0, 1]$).
  * Oriented Bounding Box: `<class_id> <x1> <y1> <x2> <y2> <x3> <y3> <x4> <y4>` (rotated points normalized).
  * Segmentation: `<class_id> <x1> <y1> <x2> <y2> ...` (flattened contour polygon points normalized).
* **`data.yaml`**: Contains `names`, `nc`, and split paths ready for `yolo train data=data.yaml`.

---

## 6. Development Rules for AI Agents

1. **Language & Comments**:
   * All code comments and docstrings MUST be in **English**.
   * User communication MUST be in **Ukrainian**.
2. **Windows SQLite Locking**:
   * Always close database connections explicitly or use context managers (`with sqlite3.connect(...) as conn:`). Windows locks open files, preventing project deletion or folder manipulation.
3. **MCP Tool Restrictions**:
   * Use Google Drive / context7 MCP tools ONLY when working specifically on Google Drive tasks.
4. **Tiling Workflow for High-Res Imagery**:
   * For drone or large resolution images, use `_my_tools/images_to_tiles.py` to prepare tiles before running YOLO detection, as standard YOLO models degrade on massive downsampling.

---

## 7. Auto-Save on Image Switch Feature
* **Settings Placement**: Under the **General / Workflow** tab in the Settings modal (`annotation-style-modal`).
* **LocalStorage Key**: `visiofirm_autosave_on_switch` (`true`/`false`, default `false`).
* **Dirty Checking**: The flag `isModified` in `globals.js` tracks actual modifications (drawing, dragging, deletion, undo/redo).
* **Behavior**: When navigating to another image via arrows or thumbnails, if `isAutoSaveEnabled` and `isModified` are true, `executeSave(true)` persists the current annotations and approves the image, showing a non-blocking toast (`#autosave-toast`). Unmodified images with pre-annotations are not accidentally approved.

---

## 8. Mouse & Class Selection Interaction Model
* **Initial Load**: Upon loading or switching images, no annotation is automatically selected (`selectedAnnotation = null`). The canvas starts in a neutral state.
* **Canvas Click & Drag**:
  * **Click inside object or on handles**: Selects that object (`selectedAnnotation = clicked`), displays handles, and highlights its class in the sidebar (`.class-tag.highlighted`). Dragging moves or resizes the object.
  * **Click on empty space**: Instantly clears selection (`selectedAnnotation = null`). Does NOT create a 0-size bounding box.
  * **Drag on empty space**: Draws a new bounding box using `selectedClass`. Upon release, the newly created box is selected.
* **Class Selection**:
  * If nothing is selected on the canvas, clicking a class tag sets `selectedClass` for the next drawing, highlighted via `.class-tag.selected`.
  * If an annotation is selected, clicking a class tag renames that specific annotation.
* **Keyboard Hotkeys 1–9**: Numbers 1 to 9 instantly pick the corresponding class from `config.classes`. If an object is active, it renames its class; if no object is active, it changes the active drawing class.
* **Dynamic Cursors**:
  * `crosshair` over empty space in drawing modes.
  * `pointer` when hovering over an existing object.
  * `nwse-resize`, `nesw-resize`, `ns-resize`, `ew-resize`, and `grab` over handles.
