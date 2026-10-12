"""Exercise the installed firmware before pairing the browser; clears test items."""
import json
import time
import serial

port = serial.Serial()
port.port = '/dev/cu.wchusbserial210'
port.baudrate = 115200
port.timeout = 0.2
port.dtr = False
port.rts = False
port.open()

def request(value, expected):
    port.write((json.dumps(value, separators=(',', ':')) + '\n').encode())
    port.flush()
    until = time.monotonic() + 8
    while time.monotonic() < until:
        try:
            reply = json.loads(port.readline())
        except (ValueError, UnicodeDecodeError):
            continue
        if reply.get('type') == expected:
            return reply
    raise AssertionError(f'No {expected} response')

try:
    time.sleep(2)
    assert request({'type': 'hello'}, 'hello')['device'] == 'duenext-cyd'
    packet = {'type': 'calendar', 'version': 1, 'epoch': int(time.time()), 'offset': -14400,
              'events': [{'title': f'Connection check {i:02d} ' + 'x' * 50, 'date': '2026-09-13', 'time': '10:00', 'course': 'Device test'} for i in range(48)]}
    assert request(packet, 'ack')['count'] == 48
    assert request({'type': 'status'}, 'status')['count'] == 48
    request({'type': 'calendar', 'version': 2}, 'error')
    assert request({'type': 'status'}, 'status')['count'] == 48
    # Hardware reset: confirm the saved events survive without a new upload.
    port.rts = True
    time.sleep(0.1)
    port.rts = False
    time.sleep(2)
    assert request({'type': 'status'}, 'status')['count'] == 48
    packet['events'] = []
    assert request(packet, 'ack')['count'] == 0
    print('Hardware checks passed: identity, 48-item transfer, rejection preserves data, reboot persistence, clearing test data.')
finally:
    port.close()
