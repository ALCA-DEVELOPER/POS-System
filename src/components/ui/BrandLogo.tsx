import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  variant?: "mark" | "full" | "square";
  size?: number;
  className?: string;
  priority?: boolean;
  decorative?: boolean;
}

const VARIANT_CONFIG = {
  mark: {
    src: "/images/logo-nummie-mark.png",
    aspectRatio: 1,
  },
  full: {
    src: "/images/logo-nummie.png",
    aspectRatio: 2,
  },
  square: {
    src: "/images/logo-nummie-square.png",
    aspectRatio: 1,
  },
} as const;

export function BrandLogo({
  variant = "mark",
  size = 40,
  className,
  priority = false,
  decorative = false,
}: BrandLogoProps) {
  const { src, aspectRatio } = VARIANT_CONFIG[variant];
  const height = size;
  const width = Math.round(size * aspectRatio);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center overflow-hidden bg-[#F2EFE0] border border-[#14532D]/15 shrink-0",
        variant === "full" ? "rounded-2xl" : "rounded-xl",
        className
      )}
      style={{ width, height }}
    >
      <Image
        src={src}
        alt={decorative ? "" : "Logo Nummie"}
        width={width}
        height={height}
        priority={priority}
        className="w-full h-full object-contain"
      />
    </span>
  );
}
