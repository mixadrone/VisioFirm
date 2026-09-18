import os
import cv2
from pathlib import Path

def slice_image_to_tiles(input_dir, output_dir, tile_size=640, overlap=64):
    """
    Нарізає зображення з папки на тайли заданого розміру з перекриттям.
    
    :param input_dir: Шлях до папки з вхідними зображеннями
    :param output_dir: Шлях до папки для збереження тайлів
    :param tile_size: Розмір тайла (за замовчуванням 640)
    :param overlap: Перекриття між тайлами в пікселях (щоб не втрачати об'єкти на краях)
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Підтримувані формати зображень
    valid_extensions = ('.jpg', '.jpeg', '.png', '.tif', '.tiff')
    image_files = [f for f in input_path.iterdir() if f.suffix.lower() in valid_extensions]
    
    if not image_files:
        print(f"У папці {input_dir} не знайдено підтримуваних зображень.")
        return

    step = tile_size - overlap  # крок з урахуванням перекриття

    for img_path in image_files:
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"Не вдалося завантажити зображення: {img_path.name}")
            continue
            
        h, w, _ = img.shape
        base_name = img_path.stem
        
        count = 0
        y = 0
        while y < h:
            # Коригуємо вихід за нижню межу
            if y + tile_size > h:
                y_start = max(0, h - tile_size)
            else:
                y_start = y
                
            x = 0
            while x < w:
                # Коригуємо вихід за праву межу
                if x + tile_size > w:
                    x_start = max(0, w - tile_size)
                else:
                    x_start = x
                
                # Вирізаємо тайл
                tile = img[y_start:y_start + tile_size, x_start:x_start + tile_size]
                
                # Формуємо унікальне ім'я для тайла із зазначенням координат
                tile_name = f"{base_name}_x{x_start}_y{y_start}.jpg"
                cv2.imwrite(str(output_path / tile_name), tile)
                count += 1
                
                if x + tile_size >= w:
                    break
                x += step
                
            if y + tile_size >= h:
                break
            y += step
            
        print(f"Оброблено {img_path.name}: створено {count} тайлів.")

# Приклад запуску
if __name__ == "__main__":
    INPUT_FOLDER = r"G:\.shortcut-targets-by-id\1lODpGpFOE_pPedyrKVx1yd8GPp1jbfvF\0. PVWISE Projects\20260915_143602_4145 East Route 9, Cuba, NM\01_Pilot\Upload\Serial Number Scan CS\DJI_202609161353_002"     # Папка з оригінальними фото з дрона
    OUTPUT_FOLDER = r"Z:\tiles_640"     # Папка, куди збережуться тайли 1280x1280
    
    slice_image_to_tiles(
        input_dir=INPUT_FOLDER, 
        output_dir=OUTPUT_FOLDER, 
        tile_size=1280, 
        overlap=64  # 10% перекриття (можна змінити на 0, якщо перекриття не потрібне)
    )