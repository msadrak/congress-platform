import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INSTALL_HINT_DISMISSED_KEY,
  installAllowedOnPath,
  installDismissedKey,
  installOffer,
  isIosInstallBrowser,
  type InstallContext,
  type InstallPersona,
} from "../src/lib/installPrompt.ts";

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IOS_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.12.108 (iPhone14,5; iOS 17_4; en_US; en; scale=3.00; 1170x2532; 566000000)";
// In-app browsers of messengers are plain web views: no "Safari/" token at all.
const IOS_WEB_VIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IOS_CHROME_OLD =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
const IOS_CHROME_NEW =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
const IPADOS_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PASS_PATH = "/c/alpha/my-ticket";

function context(over: Partial<InstallContext> = {}): InstallContext {
  return {
    persona: "attendee",
    pathname: PASS_PATH,
    userAgent: ANDROID_CHROME,
    maxTouchPoints: 5,
    promptable: true,
    standalone: false,
    dismissed: false,
    phone: true,
    ...over,
  };
}

describe("installPrompt — which iOS browsers can add a page to the home screen", () => {
  it("accepts Safari on iPhone and iPad (an iPad asks for the desktop site and says it is a Mac)", () => {
    assert.equal(isIosInstallBrowser(IOS_SAFARI, 5), true);
    assert.equal(isIosInstallBrowser(IPADOS_DESKTOP_UA, 5), true);
  });

  it("accepts Chrome on iOS only from 16.4, when it learned to add to the home screen", () => {
    assert.equal(isIosInstallBrowser(IOS_CHROME_OLD, 5), false);
    assert.equal(isIosInstallBrowser(IOS_CHROME_NEW, 5), true);
  });

  it("refuses the in-app browsers of messengers and social apps", () => {
    assert.equal(isIosInstallBrowser(IOS_INSTAGRAM, 5), false);
    assert.equal(isIosInstallBrowser(IOS_WEB_VIEW, 5), false);
  });

  it("is false off iOS", () => {
    assert.equal(isIosInstallBrowser(ANDROID_CHROME, 5), false);
    assert.equal(isIosInstallBrowser(DESKTOP_CHROME, 0), false);
  });
});

describe("installPrompt — where each install offer may appear", () => {
  it("attendee: only on the pass page and the SMS pass page", () => {
    for (const path of [PASS_PATH, "/c/alpha/my-ticket/", "/t/abc123"]) assert.equal(installAllowedOnPath("attendee", path), true, path);
    for (const path of [
      "/",
      "/e/alpha",
      "/e/alpha/booths/b1",
      "/me",
      "/c/alpha/my-congress",
      "/c/alpha/my-network",
      "/c/alpha/my-profile",
      "/c/alpha/sign-in",
      "/c/alpha/details",
      "/sign-in",
      "/organizer",
      "/organizer/events/e1/check-in",
      "/platform",
      "/reception/e1",
      "/scan/p1",
      "/booth/b1",
    ]) {
      assert.equal(installAllowedOnPath("attendee", path), false, path);
    }
  });

  it("scanner: only on its own screen", () => {
    assert.equal(installAllowedOnPath("scanner", "/scan/p1"), true);
    for (const path of ["/", "/me", PASS_PATH, "/booth/b1", "/reception/e1", "/organizer", "/platform"]) {
      assert.equal(installAllowedOnPath("scanner", path), false, path);
    }
  });

  it("booth: on the booth panel, not on its sign-in", () => {
    assert.equal(installAllowedOnPath("booth", "/booth/b1"), true);
    for (const path of ["/booth/b1/sign-in", "/", "/me", PASS_PATH, "/scan/p1", "/reception/e1", "/organizer"]) {
      assert.equal(installAllowedOnPath("booth", path), false, path);
    }
  });

  it("nobody: the desk, the organizer console, the platform console and the public pages", () => {
    const personas: InstallPersona[] = ["attendee", "scanner", "booth"];
    for (const persona of personas) {
      for (const path of ["/reception", "/reception/e/alpha", "/reception/e1", "/organizer", "/platform", "/platform/sign-in", "/", "/e/alpha"]) {
        assert.equal(installAllowedOnPath(persona, path), false, `${persona} ${path}`);
      }
    }
  });
});

describe("installPrompt — the dismissal is remembered per persona", () => {
  it("keeps the attendee's existing key and gives the operators their own", () => {
    assert.equal(INSTALL_HINT_DISMISSED_KEY, "congress_install_hint_dismissed");
    assert.equal(installDismissedKey("attendee"), INSTALL_HINT_DISMISSED_KEY);
    assert.notEqual(installDismissedKey("scanner"), INSTALL_HINT_DISMISSED_KEY);
    assert.notEqual(installDismissedKey("booth"), INSTALL_HINT_DISMISSED_KEY);
    assert.notEqual(installDismissedKey("scanner"), installDismissedKey("booth"));
  });
});

describe("installPrompt — what the install row offers", () => {
  it("offers the browser's own prompt once the browser has said it can install", () => {
    assert.equal(installOffer(context()), "prompt");
  });

  it("offers nothing on Android until the browser fires beforeinstallprompt", () => {
    assert.equal(installOffer(context({ promptable: false })), null);
  });

  it("offers the how-to steps on iOS Safari, where there is no prompt", () => {
    assert.equal(installOffer(context({ userAgent: IOS_SAFARI, promptable: false })), "ios");
  });

  it("offers nothing in an iOS in-app browser or an old iOS Chrome", () => {
    for (const userAgent of [IOS_INSTAGRAM, IOS_WEB_VIEW, IOS_CHROME_OLD]) {
      assert.equal(installOffer(context({ userAgent, promptable: false })), null, userAgent);
    }
  });

  it("offers nothing to an installed app, or after the person said no", () => {
    assert.equal(installOffer(context({ standalone: true })), null);
    assert.equal(installOffer(context({ standalone: true, userAgent: IOS_SAFARI, promptable: false })), null);
    assert.equal(installOffer(context({ dismissed: true })), null);
    assert.equal(installOffer(context({ dismissed: true, userAgent: IOS_SAFARI, promptable: false })), null);
  });

  it("offers nothing off the pages named for the persona", () => {
    for (const pathname of ["/", "/e/alpha", "/me", "/organizer", "/platform", "/reception/e1"]) {
      assert.equal(installOffer(context({ pathname })), null, pathname);
    }
  });

  it("attendee and booth rows are for phones; a desktop never gets them, prompt or not", () => {
    assert.equal(installOffer(context({ phone: false, userAgent: DESKTOP_CHROME, maxTouchPoints: 0 })), null);
    assert.equal(installOffer(context({ persona: "booth", pathname: "/booth/b1", phone: false })), null);
    assert.equal(installOffer(context({ persona: "booth", pathname: "/booth/b1" })), "prompt");
  });

  it("the scanner row also works on a tablet or desktop Chrome, which can install the scanner", () => {
    assert.equal(installOffer(context({ persona: "scanner", pathname: "/scan/p1", phone: false })), "prompt");
    assert.equal(installOffer(context({ persona: "scanner", pathname: "/scan/p1", phone: false, userAgent: IOS_SAFARI, promptable: false })), "ios");
  });
});
