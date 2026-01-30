// src/components/body/BodyTriplingIntro.tsx
export function BodyTriplingIntro() {
    return (
        <div className="w-full flex justify-center">
            <div className="w-full max-w-[980px]">
                <div className="border border-[#DBD8D8] rounded-[24px] bg-white px-5 py-5 sm:px-8 sm:py-6">
                    <div className="text-center">
                        <h2 className="font-inter font-semibold text-[20px] sm:text-[24px] text-[#111827]">
                            Body tripling
                        </h2>

                        <p className="font-inter font-light text-[14px] sm:text-[16px] leading-[160%] text-[#111827] mt-3 max-w-[860px] mx-auto">
                            Body tripling sessions are structured co-working sessions for accountability
                            and deep focus. Pick a duration, schedule a start time, and join
                            with others to stay on track.
                        </p>
                    </div>
                </div>

                <div className="h-12" />
            </div>
        </div>
    );
}
