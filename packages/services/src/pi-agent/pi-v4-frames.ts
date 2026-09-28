import { randomUUID } from "node:crypto";
import {
  encodeTopicWireFrames,
  measureTopicNotificationEnvelopeBytes,
  type ConversationTopicFrame,
  type ConversationTopicWireCandidate,
  type SessionsIndexTopicFrame,
  type SessionsIndexTopicWireCandidate,
  type TopicFrameDeliveryKind,
  type WorkspaceConfigTopicFrame,
  type WorkspaceConfigTopicWireCandidate,
} from "@zcode/shared/zcode-protocol-v4";

export type PiLogicalFrame = ConversationTopicFrame | SessionsIndexTopicFrame | WorkspaceConfigTopicFrame;
export type PiWireCandidate = ConversationTopicWireCandidate | SessionsIndexTopicWireCandidate | WorkspaceConfigTopicWireCandidate;

/** Encode with the same physical-frame limits used by the native transport. */
export function piWireFrames<F extends PiLogicalFrame>(
  frame: F,
  deliveryKind: TopicFrameDeliveryKind,
  ordinal: number,
): PiWireCandidate[] {
  return encodeTopicWireFrames(frame, {
    deliveryKind,
    topic: frame.topic,
    subscriptionId: frame.subscriptionId,
    logicalFrameId: randomUUID(),
    logicalFrameOrdinal: ordinal,
    measurePhysicalFrameBytes: wire => measureTopicNotificationEnvelopeBytes(wire).maxBytes,
  }) as PiWireCandidate[];
}
