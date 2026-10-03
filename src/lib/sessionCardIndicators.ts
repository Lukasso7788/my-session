import type { RoomPolicies } from "./roomPolicies";

export function getSessionCardPolicyState(policies: RoomPolicies) {
  // A hard requirement supersedes the alternative requirement if old schedule
  // data happens to contain both; never describe that as an AND rule.
  const either = policies.cameraOrScreenShareRequired === true &&
    !policies.cameraRequired && !policies.screenShareRequired;
  const camera = policies.cameraRequired || either;
  const screen = policies.screenShareRequired === true || either;
  const chat = policies.publicChatDisabled;
  const label = [
    either ? "Camera or screen share required" : null,
    !either && camera ? "Camera required" : null,
    !either && screen ? "Screen share required" : null,
    chat ? "Public chat off" : null,
  ].filter(Boolean).join(" · ");
  return { camera, screen, chat, either, label, count: Number(camera) + Number(screen) + Number(chat) };
}
