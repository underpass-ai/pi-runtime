import { DomainError } from "../shared/DomainError.ts";
import { ServerName } from "../mcp/ServerName.ts";
import { ToolName } from "../mcp/ToolName.ts";
import { ProfileId } from "./ProfileId.ts";
import { ToolProfile } from "./ToolProfile.ts";

const names = (xs: string[]) => xs.map((x) => ToolName.of(x));

export class ToolProfiles {
  readonly #profiles: ToolProfile[];
  private constructor(p: ToolProfile[]) { this.#profiles = p; }

  static standard(): ToolProfiles {
    return new ToolProfiles([
      ToolProfile.of(ProfileId.KMP_INTERACTIVE, ServerName.KMP, names(["kmp_guide", "kmp_wake", "kmp_ask", "kmp_time", "kmp_trace", "kmp_inspect", "kmp_relate", "kmp_write_memory", "kmp_relabel", "kmp_condense", "kmp_view_open", "kmp_view_get_state", "kmp_view_apply_intent"])),
      ToolProfile.of(ProfileId.KMP_PROJECTION, ServerName.KMP, names(["kmp_ingest", "kmp_curate", "kmp_relabel", "kmp_summaries_audit", "kmp_write_memory"])),
      ToolProfile.of(ProfileId.MADE_SESSION, ServerName.MADE, names(["made_discover_capabilities", "made_start_published_ceremony", "made_list_ceremony_definitions", "made_get_ceremony_definition", "made_get_ceremony_instance", "made_bind_ceremony_integrator", "made_await_integrator_attention", "made_acknowledge_integrator_attention", "made_issue_authorization_grant", "made_revoke_authorization_grant", "made_approve_authorization_operation", "made_get_budget_report", "made_plan_ceremony_successor", "made_start_ceremony_successor", "made_inspect_ceremony_resume", "made_record_ceremony_host_handoff", "made_pull_ceremony_events"])),
      ToolProfile.of(ProfileId.MADE_WORKER, ServerName.MADE, names(["made_claim_ceremony_step", "made_complete_ceremony_step", "made_renew_ceremony_step_lease", "made_report_ceremony_agent_status", "made_pull_ceremony_agent_interventions", "made_acknowledge_ceremony_agent_intervention", "made_get_execution_receipt", "made_complete_execution_receipt", "made_adopt_execution_receipt", "made_inspect_execution_recovery", "made_assert_ceremony_reason"])),
    ]);
  }

  forServer(server: ServerName): ToolProfile[] { return this.#profiles.filter((p) => p.server.equals(server)); }
  byId(id: ProfileId): ToolProfile {
    const p = this.#profiles.find((x) => x.id.equals(id));
    if (!p) throw DomainError.because(`no profile ${id}`);
    return p;
  }
}
