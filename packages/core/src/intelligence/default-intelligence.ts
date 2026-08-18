/**
 * The default intelligence module: what sits between the two seams.
 *
 * Above it, `SplitProvider` and `DestinationProvider` speak Waypoint's own
 * vocabulary. Below it, a `Transport` carries bytes and has never heard of a
 * project. This module owns everything in between — request construction,
 * response parsing, verbatim verification, coverage arithmetic, and the
 * suggest-don't-decide semantics.
 *
 * It owns no I/O and can reach no write verb. It is handed a transport and
 * nothing else: no vault, no catalog, no policy, no clock. A contributor who
 * wanted to consult a rule from here, or read a file from here, would have to
 * change this signature, which is a visible edit rather than a quiet call to
 * something already injected (research R2, R11).
 *
 * One factory, mirroring `createDefaultPolicy()`. No loader, no discovery, no
 * registration API — the same restraint Principle V requires of the policy
 * seam (FR-057).
 */

import type {
  DestinationProvider,
  DestinationRequest,
  DestinationResponse,
  PreparedProposal,
  SplitProvider,
  SplitRequest,
  SplitResponse,
  Transport,
} from "../ports/index";
import { renderDestinationRequest, renderSplitRequest } from "./request";
import { parseDestinationResponse, parseSplitResponse } from "./response";

export function createDefaultIntelligence(
  transport: Transport,
): SplitProvider & DestinationProvider {
  return {
    name: transport.name,

    prepareSplit(request: SplitRequest): PreparedProposal<SplitResponse> {
      // Rendered once, here. `send` closes over this binding, so the string a
      // caller previews and the string the transport receives are one value
      // (FR-045, research R4).
      const payload = renderSplitRequest(request);

      return {
        payload,
        send: async (signal: AbortSignal): Promise<SplitResponse> => {
          const raw = await transport.send(payload, signal);
          return readSplitResponse(raw, request);
        },
      };
    },

    prepareDestination(request: DestinationRequest): PreparedProposal<DestinationResponse> {
      const payload = renderDestinationRequest(request);

      return {
        payload,
        send: async (signal: AbortSignal): Promise<DestinationResponse> => {
          const raw = await transport.send(payload, signal);
          return readDestinationResponse(raw, request);
        },
      };
    },
  };
}

function readSplitResponse(raw: string, request: SplitRequest): SplitResponse {
  // Verified against the partition *this* request presented, so an answer that
  // names a part the item does not have is caught here rather than producing a
  // piece built from nothing.
  return parseSplitResponse(raw, request.segments.length);
}

function readDestinationResponse(raw: string, _request: DestinationRequest): DestinationResponse {
  // Whether the named slug *exists* is checked one layer up, against the
  // catalogue read for this request. This layer says only what the answer was.
  return parseDestinationResponse(raw);
}
