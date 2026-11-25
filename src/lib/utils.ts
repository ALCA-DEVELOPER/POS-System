import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind CSS utility classes cleanly. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
