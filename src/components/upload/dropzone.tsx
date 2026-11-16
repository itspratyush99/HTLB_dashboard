"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES } from "@/lib/naukri/read";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Drag-and-drop area (also clickable) that accepts one .xlsx / .xls / .csv file. */
export function Dropzone({ onFile, onReject }: { onFile: (file: File) => void; onReject: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function accept(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) return onReject(`"${file.name}" is not an .xlsx, .xls or .csv file.`);
    if (file.size > MAX_FILE_BYTES) return onReject(`"${file.name}" is larger than 15 MB.`);
    onFile(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        accept(e.dataTransfer.files);
      }}
      onClick={() => input.current?.click()}
      className={cn(
        "glass flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-black/15 px-6 py-16 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-accent/40",
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        {dragging ? <FileSpreadsheet className="size-7" /> : <UploadCloud className="size-7" />}
      </div>
      <div>
        <p className="font-medium">Drop today&apos;s Naukri export here</p>
        <p className="mt-1 text-sm text-muted-foreground">.xlsx, .xls or .csv · one file at a time · up to 15 MB</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={(e) => (e.stopPropagation(), input.current?.click())}>
        Choose file
      </Button>
      <p className="max-w-md text-xs text-muted-foreground">
        The file is read in your browser. Nothing is saved until you review the preview and click Import.
      </p>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
