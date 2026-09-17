"use client";

import { PhoneInput as ReactPhoneInput } from "react-international-phone";
import "react-international-phone/style.css";

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
}

export default function PhoneInput({ id, value, onChange, placeholder, className, invalid }: PhoneInputProps) {
  return (
    <ReactPhoneInput
      defaultCountry="us"
      value={value}
      onChange={onChange}
      placeholder={placeholder || "Phone number"}
      inputProps={{ id, "aria-invalid": invalid || undefined }}
      style={
        {
          "--react-international-phone-height": "46px",
          "--react-international-phone-border-radius": "0.75rem",
          "--react-international-phone-border-color": invalid
            ? "hsl(var(--destructive))"
            : "hsl(var(--border))",
          "--react-international-phone-background-color": "hsl(var(--card))",
          "--react-international-phone-text-color": "hsl(var(--foreground))",
          "--react-international-phone-dropdown-shadow": "0 18px 40px hsl(var(--foreground) / 0.12)",
          "--react-international-phone-selected-dropdown-item-background-color": "hsl(var(--muted))",
          "--react-international-phone-dropdown-item-dial-code-color": "hsl(var(--muted-foreground))",
          "--react-international-phone-country-selector-arrow-color": "hsl(var(--muted-foreground))",
          "--react-international-phone-country-selector-background-color-hover": "hsl(var(--secondary))",
          "--react-international-phone-flag-width": "20px",
          "--react-international-phone-flag-height": "14px",
          "--react-international-phone-font-size": "14px",
        } as React.CSSProperties
      }
      className={className}
      inputClassName={`!w-full !rounded-r-xl !border !bg-card !px-4 !text-sm !text-foreground !outline-none !transition-[border-color,box-shadow] focus:!ring-[3px] ${
        invalid
          ? "!border-destructive focus:!border-destructive focus:!ring-destructive/20"
          : "!border-border focus:!border-ring focus:!ring-ring/20"
      }`}
      countrySelectorStyleProps={{
        buttonClassName: `!h-full !rounded-l-xl !border !bg-card !px-2.5 hover:!bg-secondary ${
          invalid ? "!border-destructive" : "!border-border"
        }`,
        dropdownStyleProps: {
          className: "!z-50 !overflow-auto !rounded-xl !border !border-edge !bg-popover",
          listItemClassName: "!text-sm !text-popover-foreground hover:!bg-secondary",
        },
      }}
    />
  );
}
