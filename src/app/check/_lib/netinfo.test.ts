import { describe, expect, it } from "vitest";
import { describeConnection, shortUserAgent } from "./netinfo";

describe("shortUserAgent", () => {
  it("Chrome на Windows", () => {
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome 141, Windows 10/11");
  });

  it("Edge и Яндекс Браузер не путаются с Chrome", () => {
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      ),
    ).toBe("Edge 141, Windows 10/11");
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 YaBrowser/25.10.0.0 Safari/537.36",
      ),
    ).toBe("Яндекс Браузер 25, Windows 10/11");
  });

  it("Firefox на Android, Safari на iPhone, Chrome на Linux", () => {
    expect(shortUserAgent("Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0")).toBe(
      "Firefox 131, Android 14",
    );
    expect(
      shortUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 18, iOS");
    expect(shortUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36")).toBe(
      "Chrome 139, Linux",
    );
  });

  it("Chrome на Android и Samsung Internet", () => {
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome 141, Android 14");
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Samsung Internet 26, Android 14");
  });

  it("незнакомое: честно «неизвестный браузер», полный UA в отчёт не попадает", () => {
    expect(shortUserAgent("curl/8.0")).toBe("неизвестный браузер");
    const out = shortUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36");
    expect(out).not.toMatch(/Mozilla|AppleWebKit|537/);
  });
});

describe("describeConnection", () => {
  it("склеивает то, что дал браузер", () => {
    expect(describeConnection({ type: "wifi", effectiveType: "4g", downlink: 10, rtt: 50 })).toBe(
      "Wi-Fi · 4g · ~10 Мбит/с · RTT ~50 мс",
    );
    expect(describeConnection({ effectiveType: "3g", downlink: 1.5, saveData: true })).toBe(
      "3g · ~1,5 Мбит/с · экономия трафика включена",
    );
  });
  it("ничего нет: null", () => {
    expect(describeConnection(undefined)).toBeNull();
    expect(describeConnection({})).toBeNull();
  });
});
