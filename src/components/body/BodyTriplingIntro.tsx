// src/components/body/BodyTriplingIntro.tsx
export function BodyTriplingIntro() {
    return (
        <div className="w-full flex justify-center">
            <div className="w-full max-w-[980px] px-3">
                <div className="text-center">
                    <h2 className="font-inter font-semibold text-[26px] sm:text-[34px] text-[#111827] leading-tight">
                        Buddy Tripling Sessions
                    </h2>

                    <p className="mt-3 font-inter font-light text-[14px] sm:text-[16px] leading-[160%] text-[#111827]/70 max-w-[760px] mx-auto">
                        Schedule a 90-minute focus session with two other buddies to stay
                        accountable as a group of three.
                    </p>
                </div>

                {/* spacing to switcher */}
                <div className="h-8 sm:h-10" />
            </div>
        </div>
    );
}
