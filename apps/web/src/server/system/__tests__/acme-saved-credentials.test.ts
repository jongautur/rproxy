import { describe, it, expect } from "vitest";
import { hasSavedKeys } from "../acme";

describe("hasSavedKeys", () => {
  it("finds a SAVED_ key written by _saveaccountconf_mutable", () => {
    expect(hasSavedKeys("ACCOUNT_EMAIL='a@b.c'\nSAVED_CF_Token='abc_123'\n", ["CF_Token"])).toBe(true);
  });

  it("finds a plain key written by the older _saveaccountconf", () => {
    expect(hasSavedKeys("GD_Key='k'\nGD_Secret='s'\n", ["GD_Key", "GD_Secret"])).toBe(true);
  });

  it("rejects empty values", () => {
    expect(hasSavedKeys("SAVED_CF_Token=''\n", ["CF_Token"])).toBe(false);
    expect(hasSavedKeys("SAVED_CF_Token=\n", ["CF_Token"])).toBe(false);
  });

  it("requires every key for the provider", () => {
    expect(hasSavedKeys("SAVED_GD_Key='k'\n", ["GD_Key", "GD_Secret"])).toBe(false);
  });

  it("does not match a key that only shares a prefix or suffix", () => {
    expect(hasSavedKeys("SAVED_CF_Token_Old='x'\n", ["CF_Token"])).toBe(false);
    expect(hasSavedKeys("MY_CF_Token='x'\n", ["CF_Token"])).toBe(false);
  });
});
