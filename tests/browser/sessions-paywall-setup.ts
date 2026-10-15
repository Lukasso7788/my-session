// Runs before profile-page-auth: a Free account whose 15 free sessions are used.
(globalThis as any).__harnessRpc = { get_lifetime_attendance_count: 15 };
(globalThis as any).__harnessTables = { user_entitlements: [] };
// Keep the community prompt out of the way.
localStorage.setItem("mysession_community_prompt_joined_at", String(Date.now()));
localStorage.setItem("mysession_support_modal_dismissed_at", String(Date.now()));
for (const kind of ["never_hosted", "inactive_host"]) localStorage.setItem(`mysession_host_prompt_dismissed_at:00000000-0000-4000-8000-000000000001:${kind}`, String(Date.now()));
export {};