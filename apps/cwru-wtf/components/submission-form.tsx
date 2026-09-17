"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import PhoneInput from "@/components/phone-input";

const submissionSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z
      .string()
      .email("Invalid email address")
      .endsWith("@case.edu", "Must be a @case.edu email"),
    categories: z
      .array(z.string())
      .min(1, "Please select at least one category"),
    otherCategory: z.string().optional(),
    wtfIdea: z
      .string()
      .min(1, "Please tell us your WTF idea")
      .max(600, "Maximum 100 words (approximately 600 characters)"),
    currentProject: z
      .string()
      .min(1, "Please tell us about your current project")
      .max(600, "Maximum 100 words (approximately 600 characters)"),
    youtubeLink: z.string().url("Please enter a valid URL"),
    whatsapp: z
      .string()
      .min(1, "Please add your WhatsApp number")
      // The country selector prefills a dial code, so a field the user never
      // touched still arrives as "+1". Count the digits instead of the
      // characters: E.164 allows 15 at most, and nothing real is under 8.
      .refine((val) => {
        const digits = val.replace(/\D/g, "");
        return digits.length >= 8 && digits.length <= 15;
      }, "Please enter a valid WhatsApp number"),
  })
  .refine(
    (data) => {
      // If "Other" is selected, otherCategory should be provided
      if (
        data.categories.includes("Other") &&
        (!data.otherCategory || data.otherCategory.trim() === "")
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Please specify the other category",
      path: ["otherCategory"],
    }
  );

type SubmissionData = z.infer<typeof submissionSchema>;

export default function SubmissionForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [whatsappValue, setWhatsappValue] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SubmissionData>({
    resolver: zodResolver(submissionSchema),
    defaultValues: {
      categories: [],
      // The country selector shows a prefilled "+1 " but keeps it internal —
      // its onChange only fires on interaction — so without a default here an
      // untouched field submits as undefined and zod answers "Required"
      // instead of the message below it.
      whatsapp: "",
    },
  });

  const watchCategories = watch("categories");

  const onSubmit = async (data: SubmissionData) => {
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success(
          "Application submitted successfully! We'll be in touch soon."
        );
        reset();
        setShowOtherInput(false);
        setWhatsappValue("");
      } else {
        if (result.error === "Email already submitted") {
          toast.error(
            "This email has already been submitted. Check your inbox for updates!"
          );
        } else if (result.details) {
          // Handle validation errors
          result.details.forEach((error: any) => {
            toast.error(error.message);
          });
        } else {
          toast.error(
            result.error || "Something went wrong. Please try again."
          );
        }
      }
    } catch (error) {
      console.error("Submission error:", error);
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCategoryChange = (category: string, checked: boolean) => {
    const currentCategories = watchCategories || [];
    if (checked) {
      setValue("categories", [...currentCategories, category]);
      if (category === "Other") {
        setShowOtherInput(true);
      }
    } else {
      setValue(
        "categories",
        currentCategories.filter((c) => c !== category)
      );
      if (category === "Other") {
        setShowOtherInput(false);
        setValue("otherCategory", "");
      }
    }
  };

  const categoryOptions = [
    "Photography / Film",
    "Art / Design",
    "Coding / Software",
    "Hardware / Electronics",
    "Other",
  ];

  return (
    <form className="mx-auto mt-12 max-w-md" onSubmit={handleSubmit(onSubmit)}>
      <div className="grid gap-6">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input
            {...register("name")}
            id="name"
            placeholder="Your Name"
            invalid={!!errors.name}
            className="mt-2"
          />
          {errors.name && (
            <p className="mt-2 font-primary text-body-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            {...register("email")}
            type="email"
            id="email"
            placeholder="you@case.edu"
            invalid={!!errors.email}
            className="mt-2"
          />
          {errors.email && (
            <p className="mt-2 font-primary text-body-sm text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <PhoneInput
            id="whatsapp"
            value={whatsappValue}
            onChange={(val) => {
              setWhatsappValue(val);
              // Registered fields revalidate on change once they have failed a
              // submit; this one is set by hand, so mirror that rather than
              // validating from the first keystroke.
              setValue("whatsapp", val, {
                shouldValidate: !!errors.whatsapp,
              });
            }}
            placeholder="WhatsApp number"
            invalid={!!errors.whatsapp}
            className="mt-2"
          />
          {errors.whatsapp ? (
            <p className="mt-2 font-primary text-body-sm text-destructive">
              {errors.whatsapp.message}
            </p>
          ) : (
            <p className="mt-2 flex items-start gap-1.5 text-body-sm text-muted-foreground">
              <span className="shrink-0 leading-5">💬</span>
              <span>Our community hangs out on WhatsApp — this is how we&apos;ll reach you</span>
            </p>
          )}
        </div>

        <div>
          <Label className="mb-3">What&apos;s your thing?</Label>
          <div className="space-y-1">
            {categoryOptions.map((category) => (
              <label
                key={category}
                className="flex cursor-pointer items-center rounded-xl px-3 py-2 text-sm transition-colors hover:bg-secondary"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-border accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
                  checked={watchCategories?.includes(category) || false}
                  onChange={(e) =>
                    handleCategoryChange(category, e.target.checked)
                  }
                />
                <span className="ml-3 text-foreground">{category}</span>
              </label>
            ))}
          </div>
          {errors.categories && (
            <p className="mt-2 font-primary text-body-sm text-destructive">
              {errors.categories.message}
            </p>
          )}
        </div>

        {showOtherInput && (
          <div>
            <Input
              {...register("otherCategory")}
              placeholder="Please specify your other category"
              invalid={!!errors.otherCategory}
            />
            {errors.otherCategory && (
              <p className="mt-2 font-primary text-body-sm text-destructive">
                {errors.otherCategory.message}
              </p>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="wtfIdea">Your WTF idea</Label>
          <Textarea
            {...register("wtfIdea")}
            id="wtfIdea"
            placeholder="What do you want to build that would make you go WTF? (100 words max)"
            rows={4}
            invalid={!!errors.wtfIdea}
            className="mt-2"
          />
          {errors.wtfIdea && (
            <p className="mt-2 font-primary text-body-sm text-destructive">
              {errors.wtfIdea.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="currentProject">Current project</Label>
          <Textarea
            {...register("currentProject")}
            id="currentProject"
            placeholder="What's something you have built or are building right now? (100 words max)"
            rows={4}
            invalid={!!errors.currentProject}
            className="mt-2"
          />
          {errors.currentProject && (
            <p className="mt-2 font-primary text-body-sm text-destructive">
              {errors.currentProject.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="youtubeLink">
            A video of something that interests you
          </Label>
          <Input
            {...register("youtubeLink")}
            type="url"
            id="youtubeLink"
            placeholder="https://..."
            invalid={!!errors.youtubeLink}
            className="mt-2"
          />
          {errors.youtubeLink && (
            <p className="mt-2 font-primary text-body-sm text-destructive">
              {errors.youtubeLink.message}
            </p>
          )}
        </div>

        <Button type="submit" size="xl" disabled={isSubmitting}>
          {isSubmitting ? "Submitting..." : "Submit Application"}
        </Button>
      </div>
    </form>
  );
}
