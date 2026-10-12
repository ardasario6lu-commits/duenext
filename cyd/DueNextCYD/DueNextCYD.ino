#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <XPT2046_Touchscreen.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <sys/time.h>

SPIClass displaySPI(HSPI), touchSPI(VSPI);
Adafruit_ILI9341 tft(&displaySPI, 2, 15, -1);
XPT2046_Touchscreen touch(33, 36);
JsonDocument calendar;
String input;
bool dropping = false, clockSet = false, live = false;
uint32_t lastSync = 0, lastTouch = 0, lastDraw = 0;
int page = 0, offsetSeconds = 0;
constexpr uint16_t BG = 0x0841, MUTED = 0x9CD3, ACCENT = 0x9EBA;

void label(String s, int x, int y, int size = 1, uint16_t color = ILI9341_WHITE) {
  tft.setCursor(x, y); tft.setTextSize(size); tft.setTextColor(color, BG); tft.print(s);
}
String clipped(String s, unsigned int n) { return s.length() > n ? s.substring(0, n - 3) + "..." : s; }
String dateToday() {
  time_t now = time(nullptr) + offsetSeconds; struct tm tm; gmtime_r(&now, &tm);
  char date[11]; strftime(date, sizeof(date), "%Y-%m-%d", &tm); return String(date);
}
int visibleCount() {
  int count = 0; String today = dateToday();
  for (JsonObject e : calendar["events"].as<JsonArray>()) if (!clockSet || String(e["date"] | "") >= today) count++;
  return count;
}
void draw() {
  tft.fillScreen(BG);
  label("duenext.", 12, 10, 2, ACCENT);
  String today = dateToday();
  if (clockSet) {
    time_t now = time(nullptr) + offsetSeconds; struct tm tm; gmtime_r(&now, &tm);
    char date[26]; strftime(date, sizeof(date), "%a %b %d  %H:%M", &tm); label(date, 12, 36, 1, MUTED);
  } else label("Saved calendar - reconnect to set clock", 12, 36, 1, MUTED);
  tft.drawFastHLine(12, 53, 296, 0x3186);
  JsonArray events = calendar["events"].as<JsonArray>();
  int visible[48], count = 0;
  for (int i = 0; i < (int)events.size() && i < 48; i++) {
    String date = events[i]["date"] | "";
    if (!clockSet || date >= today) visible[count++] = i;
  }
  int pages = max(1, (count + 2) / 3); page = constrain(page, 0, pages - 1);
  if (!calendar["events"].is<JsonArray>()) {
    label("Your calendar goes here", 12, 80, 2);
    label("Open DueNext in Chrome on your laptop.", 12, 119);
    label("Connections > Connect CYD", 12, 139, 1, ACCENT);
    label("Choose the USB serial display.", 12, 159, 1, MUTED);
  } else if (!count) {
    label("You're all caught up.", 12, 90, 2);
    label("No upcoming unfinished items.", 12, 125, 1, MUTED);
  } else {
    for (int row = 0; row < 3; row++) {
      int idx = page * 3 + row; if (idx >= count) break;
      JsonObject e = events[visible[idx]];
      int y = 64 + row * 49;
      String date = e["date"] | ""; String when = date == today && clockSet ? "TODAY" : date.substring(5);
      String at = e["time"] | "";
      label(when + "  " + (at.length() ? at : "All day") + "  " + clipped(e["course"] | "", 20), 12, y, 1, MUTED);
      String title = e["title"] | "Untitled";
      label(title.substring(0, 24), 12, y + 12, 2);
      if (title.length() > 24) label(clipped(title.substring(24), 24), 12, y + 28, 2);
    }
  }
  tft.drawFastHLine(12, 212, 296, 0x3186);
  label("<", 12, 222, 1, ACCENT);
  String footer = live ? "USB synced" : "Saved copy";
  label(footer + "   " + String(page + 1) + "/" + String(pages) + "   Tap to browse", 32, 222, 1, MUTED);
  label(">", 300, 222, 1, ACCENT);
  lastDraw = millis();
}
void error(const char* message) { JsonDocument d; d["type"] = "error"; d["message"] = message; serializeJson(d, Serial); Serial.println(); }
void receive(String line) {
  JsonDocument d;
  if (deserializeJson(d, line)) { error("Invalid JSON"); return; }
  String type = d["type"] | "";
  if (type == "hello") { Serial.println("{\"type\":\"hello\",\"device\":\"duenext-cyd\",\"version\":1}"); return; }
  if (type == "clear" && d["version"] == 1) {
    if (LittleFS.exists("/calendar.json") && !LittleFS.remove("/calendar.json")) { error("Could not clear saved calendar"); return; }
    if (LittleFS.exists("/calendar.tmp") && !LittleFS.remove("/calendar.tmp")) { error("Could not clear temporary calendar"); return; }
    calendar.clear(); live = false; page = 0; draw();
    Serial.println("{\"type\":\"ack\",\"count\":0}"); return;
  }
  if (type == "status") {
    JsonDocument status; status["type"] = "status"; status["count"] = calendar["events"].size();
    status["first"] = calendar["events"][0]["title"] | ""; status["live"] = live;
    status["clockSet"] = clockSet; status["freeHeap"] = ESP.getFreeHeap();
    serializeJson(status, Serial); Serial.println(); return;
  }
  if (type != "calendar" || d["version"] != 1 || !d["events"].is<JsonArray>() || d["events"].size() > 48 || !d["epoch"].is<long>() || !d["offset"].is<int>()) { error("Unsupported calendar packet"); return; }
  for (JsonObject e : d["events"].as<JsonArray>()) {
    if (!e["title"].is<const char*>() || strlen(e["title"]) > 80 || !e["date"].is<const char*>() || strlen(e["date"]) != 10 || !e["time"].is<const char*>() || strlen(e["time"]) > 5 || !e["course"].is<const char*>() || strlen(e["course"]) > 30) { error("Invalid event"); return; }
  }
  // Write only when the event data changes, not on every clock heartbeat.
  String oldEvents, newEvents; serializeJson(calendar["events"], oldEvents); serializeJson(d["events"], newEvents);
  if (oldEvents != newEvents) {
    File f = LittleFS.open("/calendar.tmp", "w");
    if (!f) { error("Could not save calendar"); return; }
    size_t expected = measureJson(d); size_t written = serializeJson(d, f); f.close();
    if (written != expected || !LittleFS.rename("/calendar.tmp", "/calendar.json")) { error("Could not save calendar"); return; }
  }
  offsetSeconds = d["offset"].as<int>();
  timeval tv = { d["epoch"].as<long>(), 0 }; settimeofday(&tv, nullptr); clockSet = true;
  calendar = d; live = true; lastSync = millis(); draw();
  JsonDocument ack; ack["type"] = "ack"; ack["count"] = calendar["events"].size(); serializeJson(ack, Serial); Serial.println();
}
void setup() {
  Serial.setRxBufferSize(32768); Serial.begin(115200); input.reserve(20000);
  pinMode(21, OUTPUT); digitalWrite(21, HIGH);
  for (int pin : {4, 16, 17}) { pinMode(pin, OUTPUT); digitalWrite(pin, HIGH); }
  displaySPI.begin(14, 12, 13, 15); tft.begin(40000000); tft.setRotation(1); tft.setTextWrap(false);
  touchSPI.begin(25, 39, 32, 33); touch.begin(touchSPI); touch.setRotation(1);
  if (LittleFS.begin(true)) { File f = LittleFS.open("/calendar.json", "r"); if (f) { deserializeJson(calendar, f); f.close(); } }
  draw(); Serial.println("{\"type\":\"ready\",\"device\":\"duenext-cyd\",\"version\":1}");
}
void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { if (!dropping && input.length()) receive(input); else if (dropping) error("Packet too large"); input = ""; dropping = false; }
    else if (c != '\r' && !dropping) { if (input.length() < 24000) input += c; else { input = ""; dropping = true; } }
  }
  if (live && millis() - lastSync > 75000) { live = false; draw(); }
  if (clockSet && millis() - lastDraw > 30000) draw();
  if (touch.touched() && millis() - lastTouch > 350) {
    TS_Point p = touch.getPoint(); lastTouch = millis();
    int pages = max(1, (visibleCount() + 2) / 3);
    page = (page + (p.x < 2000 ? pages - 1 : 1)) % pages; draw();
  }
  delay(2);
}
