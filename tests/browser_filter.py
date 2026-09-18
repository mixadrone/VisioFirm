"""Exercise the real template, styles and list modules in isolated headless Chrome.

Run: python tests/browser_filter.py
No project database or application server is used.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
import re
import mimetypes
import shutil
import subprocess
import argparse

from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parents[1]
env = Environment(loader=FileSystemLoader(ROOT / 'visiofirm/templates'), autoescape=True)
page = env.get_template('image_annotation.html').render(
    project_name='Filter regression', setup_type='Bounding Box', classes=['object'],
    image_annotators={}, current_user_avatar='T', user=SimpleNamespace(username='Test'),
    request=SimpleNamespace(query_params={}),
    images=[dict(id=i, filename=f'img_{i}.jpg', url=f'/images/img_{i}.jpg',
                 date='2026-09-19', annotated=i == 1, preannotated=i == 2)
            for i in range(1, 7)],
)
# Keep configuration JSON, but replace application startup with an isolated scenario.
page = re.sub(r'<script\b(.*?)>.*?</script>',
              lambda m: m[0] if 'application/json' in m[1] else '', page, flags=re.S)
page = re.sub(r'<link[^>]+href="https://[^>]+>', '', page)
page = page.replace('</body>', '<script type="module" src="/scenario.js"></script></body>')

SCENARIO = r"""
import * as list from '/static/js/viewManagement.js';
import { initializeImageListControls } from '/static/js/imageListControls.js';
const results = [];
const check = (value, message) => { if (!value) throw Error(message); results.push(message); };
const visible = selector => [...document.querySelectorAll(selector)].filter(el => getComputedStyle(el).display !== 'none');
try {
    localStorage.setItem('visiofirm_image_list:Filter regression', JSON.stringify({ sort: 'name-asc', filter: 'preannotated' }));
    list.initializeGridView();
    check(visible('.grid-card').length === 1, 'saved Pre-Annotated filter restored on startup');
    initializeImageListControls({ ...list, onChange() {} });
    initializeImageListControls({ ...list, onChange() {} });
    await new Promise(resolve => setTimeout(resolve, 400));
    const button = document.getElementById('filter-btn');
    const menu = button.parentElement;
    const content = menu.querySelector('.dropdown-content');
    for (let repeat = 0; repeat < 3; repeat++) {
        button.click();
        check(getComputedStyle(content).display === 'block', 'button opens menu');
        button.click();
        check(getComputedStyle(content).display === 'none', 'second click closes menu');
        for (const [filter, count] of [['annotated', 1], ['all', 6], ['preannotated', 1], ['unannotated', 4], ['all', 6]]) {
            button.click();
            const option = menu.querySelector(`[data-filter="${filter}"]`);
            const rect = option.getBoundingClientRect();
            check(option.contains(document.elementFromPoint(rect.x + 20, rect.y + rect.height / 2)), 'option is above cards and clickable');
            option.click();
            check(getComputedStyle(content).display === 'none', 'selection closes menu');
            check(visible('.grid-card').length === count, `grid ${filter}: ${count}`);
            check(visible('.thumbnail-row').length === count, `thumbnails ${filter}: ${count}`);
            check(document.getElementById('filter-btn-annotation').textContent.trim() === button.textContent.trim(), 'filter labels synchronized');
        }
    }
    list.toggleView('list');
    list.filterImages('annotated');
    check(visible('#list-table tbody tr').length === 1, 'list view filters');
    list.filterImages('all');
    check(visible('#list-table tbody tr').length === 6, 'list view restores all rows');
    list.switchToAnnotationView();
    await new Promise(resolve => setTimeout(resolve, 400));
    const sideButton = document.getElementById('filter-btn-annotation');
    sideButton.click();
    const sideOption = sideButton.parentElement.querySelector('[data-filter="preannotated"]');
    const rect = sideOption.getBoundingClientRect();
    check(sideOption.contains(document.elementFromPoint(rect.x + 20, rect.y + rect.height / 2)), 'sidebar option is clickable');
    sideOption.click();
    check(visible('.thumbnail-row').length === 1, 'sidebar applies filter');
    sideButton.click();
    sideButton.parentElement.querySelector('[data-filter="all"]').click();
    check(visible('.thumbnail-row').length === 6, 'sidebar restores previous filter');
    sideButton.click();
    document.body.dataset.testResult = `PASS: ${results.length} checks`;
} catch (error) {
    document.body.dataset.testResult = `FAIL: ${error.message}`;
}
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == '/':
            body, mime = page, 'text/html'
        elif self.path == '/scenario.js':
            body, mime = SCENARIO, 'text/javascript'
        elif self.path == '/static/js/globals.js':
            body, mime = '''export let currentImageKey = null, currentImageIndex = -1, thumbnailImages = [];
export function setThumbnailImages(value) { thumbnailImages = value; }
export function setCurrentImageIndex(value) { currentImageIndex = value; }''', 'text/javascript'
        elif self.path == '/static/js/imageHandling.js':
            body, mime = 'export function selectImage() {}', 'text/javascript'
        elif self.path.startswith('/static/'):
            target = (ROOT / 'visiofirm' / self.path.lstrip('/')).resolve()
            if not target.is_relative_to(ROOT / 'visiofirm/static') or not target.is_file():
                self.send_error(404)
                return
            body = target.read_bytes()
            mime = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.end_headers()
        self.wfile.write(body.encode() if isinstance(body, str) else body)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--screenshot', type=Path)
    args = parser.parse_args()
    chrome = shutil.which('chrome') or shutil.which('chromium')
    if not chrome:
        raise SystemExit('Chrome/Chromium must be available on PATH')
    with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server, TemporaryDirectory(prefix='visiofirm-filter-') as profile:
        Thread(target=server.serve_forever, daemon=True).start()
        screenshot_args = [f'--screenshot={args.screenshot.resolve()}'] if args.screenshot else []
        result = subprocess.run([
            chrome, '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            f'--user-data-dir={profile}', '--window-size=1440,1000', '--virtual-time-budget=5000',
            *screenshot_args, '--dump-dom', f'http://127.0.0.1:{server.server_port}/',
        ], capture_output=True, text=True, encoding='utf-8', timeout=40)
        server.shutdown()
        match = re.search(r'data-test-result="([^"]+)"', result.stdout)
        message = match[1] if match else f'Chrome did not report results: {result.stderr[-1500:]}'
        print(message)
        if not message.startswith('PASS:'):
            raise SystemExit(1)
