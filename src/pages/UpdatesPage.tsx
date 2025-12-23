import React from "react";
import { UpdateCard } from "../components/UpdateCard";
import { UPDATES } from "../data/updates";

export default function UpdatesPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 pb-20">
      <div className="mt-16 text-center">
        <h1 className="text-[44px] font-semibold tracking-[-0.03em]">
          Latest updates
        </h1>
        <p className="mt-3 text-[15px] text-black/60">
          Small weekly improvements. Big product direction.
        </p>
      </div>

      <div className="mt-10 grid gap-6">
        {UPDATES.map((u) => (
          <UpdateCard key={u.date + u.title} item={u} />
        ))}
      </div>
    </div>
  );
}
