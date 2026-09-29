import type { Check } from "../../domain/diagnosis/Check.ts";
import type { CheckDto } from "../dto/CheckDto.ts";

export class CheckMapper {
  toDto(c: Check): CheckDto { return { section: c.section.value, status: c.status.value, name: c.name.value, detail: c.detail.value }; }
}
