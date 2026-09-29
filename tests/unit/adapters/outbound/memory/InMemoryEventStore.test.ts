import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { eventStoreConformance } from "../../../../support/EventStoreConformance.ts";

eventStoreConformance("memoria", () => new InMemoryEventStore());
