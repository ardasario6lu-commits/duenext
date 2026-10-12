"""Read-only, resumable full flash backup. Uses device MD5 for blank sectors."""
import hashlib
from pathlib import Path
import esptool

root = Path(__file__).parent / 'backups'
root.mkdir(exist_ok=True, mode=0o700)
size = 65536
blank = b'\xff' * size
blank_hash = hashlib.md5(blank).hexdigest()
esp = None

def connect():
    global esp
    if esp is not None:
        esp._port.close()
    esp = esptool.detect_chip('/dev/cu.wchusbserial210', baud=115200).run_stub()
    esp.flash_spi_attach(0)

connect()
try:
    for address in range(0, 4 * 1024 * 1024, size):
        path = root / f'{address:06x}.bin'
        for attempt in range(4):
            try:
                digest = esp.flash_md5sum(address, size).lower()
                if path.exists() and hashlib.md5(path.read_bytes()).hexdigest() == digest:
                    break
                data = blank if digest == blank_hash else esp.read_flash(address, size)
                assert hashlib.md5(data).hexdigest() == digest
                path.write_bytes(data)
                break
            except Exception:
                if attempt == 3:
                    raise
                print(f'Retrying section {address:06x}', flush=True)
                connect()
        print(f'Verified {(address + size) * 100 // (4 * 1024 * 1024)}%', flush=True)
    data = b''.join((root / f'{address:06x}.bin').read_bytes() for address in range(0, 4 * 1024 * 1024, size))
    assert hashlib.md5(data).hexdigest() == esp.flash_md5sum(0, len(data)).lower()
    (root / 'original-2026-09-12.bin').write_bytes(data)
    print('Full 4 MB backup verified against device MD5.', flush=True)
finally:
    esp.hard_reset()
    esp._port.close()
