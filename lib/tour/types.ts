export type TourStep = {
  id: string;
  target: string;        // data-tour attribute value
  route: string;         // navigate here before showing step
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right";
  fallbackMessage?: string; // shown when target element not found after timeout
};

export type TourFlow = {
  id: string;
  title: string;
  description: string;   // short tagline shown on welcome card
  icon: string;          // material symbol name
  category: string;      // section label in the welcome modal
  steps: TourStep[];
};
