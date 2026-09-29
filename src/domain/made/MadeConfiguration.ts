import { DomainError } from "../shared/DomainError.ts";
import { CeremonyStoreId } from "./CeremonyStoreId.ts";
import { CursorHmacKey } from "./CursorHmacKey.ts";
import { PolicyId } from "./PolicyId.ts";
import type { StorePath } from "./StorePath.ts";
import { TrustedHostId } from "./TrustedHostId.ts";

type Props = { policy: PolicyId; trustedHost: TrustedHostId; store: CeremonyStoreId; cursorKey: CursorHmacKey };

export class MadeConfiguration {
  readonly policy: PolicyId; readonly trustedHost: TrustedHostId; readonly store: CeremonyStoreId; readonly cursorKey: CursorHmacKey;
  private constructor(p: Props) { this.policy = p.policy; this.trustedHost = p.trustedHost; this.store = p.store; this.cursorKey = p.cursorKey; }

  static of(p: Props): MadeConfiguration { return new MadeConfiguration(p); }

  static generateFor(store: StorePath, entropy: Uint8Array): MadeConfiguration {
    if (entropy.length !== 32) throw DomainError.because("cursor key needs exactly 32 bytes of entropy");
    const d = store.configDigest();
    return new MadeConfiguration({
      policy: PolicyId.of(`made-local-policy-${d}`),
      trustedHost: TrustedHostId.of(`made-local-host-${d}`),
      store: CeremonyStoreId.of(`made-local-store-${d}`),
      cursorKey: CursorHmacKey.of([...entropy].map((b) => b.toString(16).padStart(2, "0")).join("")),
    });
  }

  entries(): [string, string][] {
    return [
      ["MADE_AUTH_POLICY_ID", this.policy.value],
      ["MADE_AUTH_TRUSTED_HOST_ID", this.trustedHost.value],
      ["MADE_CEREMONY_STORE_ID", this.store.value],
      ["MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY", this.cursorKey.reveal()],
    ];
  }
}
