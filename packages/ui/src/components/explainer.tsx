"use client";
import { useEffect, useState, type ReactNode } from "react";
import { CarouselProgress } from "@dya/ui/components/carousel-progress";
import { Button } from "@dya/ui/components/button";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@dya/ui/components/carousel";

export type ExplainerSlide = { title: string; description: string; graphic: ReactNode };
export function Explainer({ slides, label, onComplete, step, onStepChange, completeLabel = "Got it" }: { slides: ExplainerSlide[]; label: string; onComplete: () => void; step?: number; onStepChange?: (step: number) => void; completeLabel?: string }) {
  const [api, setApi] = useState<CarouselApi>();
  const [selected, setSelected] = useState(0);
  const current = step ?? selected;
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!api) return;
    const update = () => { const index = api.selectedScrollSnap(); setSelected(index); onStepChange?.(index); };
    update(); api.on("select", update); api.on("reInit", update);
    return () => { api.off("select", update); api.off("reInit", update); };
  }, [api, onStepChange]);
  useEffect(() => { if (step !== undefined && api && api.selectedScrollSnap() !== step) api.scrollTo(step, reducedMotion); }, [api, step, reducedMotion]);
  function goTo(index: number) { setSelected(index); onStepChange?.(index); api?.scrollTo(index, reducedMotion); }
  if (!slides.length) return null;
  return <section aria-label={label} className="min-w-0 w-full max-w-full space-y-4">
    <Carousel className="min-w-0 w-full max-w-full" setApi={setApi} opts={{ loop: false, duration: reducedMotion ? 0 : 25 }} aria-label={`${label} slides`}>
      <CarouselContent>{slides.map((slide, index) => <CarouselItem className="overflow-hidden" key={slide.title} aria-label={`${index + 1} of ${slides.length}`} aria-hidden={index !== current} inert={index !== current}>
        <div className="flex h-40 items-center justify-center rounded-lg bg-foreground/[0.03] p-4" aria-hidden="true">{slide.graphic}</div>
        <div className="space-y-2 pt-4 text-center [overflow-wrap:anywhere]"><h3 className="text-base font-medium">{slide.title}</h3><p className="min-h-15 text-sm text-muted-foreground">{slide.description}</p></div>
      </CarouselItem>)}</CarouselContent>
    </Carousel>
    <CarouselProgress labels={slides.map(slide => slide.title)} current={current} onSelect={goTo} />
    <Button className="w-full" onClick={() => current === slides.length - 1 ? onComplete() : goTo(current + 1)}>{current === slides.length - 1 ? completeLabel : "Next"}</Button>
  </section>;
}
