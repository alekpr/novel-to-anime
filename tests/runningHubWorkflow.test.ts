import { describe, expect, it } from "vitest";
import { parseWorkflow, planWorkflow } from "../src/utils/runningHubWorkflow.js";
import { validPictureSlots, videoDuration, videoRatio } from "../src/utils/videoClipInputs.js";

const values = { prompt: "12 seconds, vertical 9:16. <Picture 1> <Picture 2>", ratio: "9:16", duration: 12,
  imagePaths: ["api/first.png", "api/second.webp"] };

describe("automatic RunningHub inputs", () => {
  it("passes the prompt, aspect ratio, seconds and ordered image list into named workflow inputs", () => {
    const graph = parseWorkflow(JSON.stringify({
      "12": { class_type: "Video", inputs: { prompt: "", aspectRatio: "16:9", duration: 10, reference_images: [], link: ["13", 0] } },
      "13": { class_type: "LoadImage", inputs: { image: "demo.png" } },
    }));
    expect(planWorkflow(graph)(values)).toEqual({ nodeInfoList: [
      { nodeId: "12", fieldName: "prompt", fieldValue: values.prompt },
      { nodeId: "12", fieldName: "aspectRatio", fieldValue: "9:16" },
      { nodeId: "12", fieldName: "duration", fieldValue: 12 },
      { nodeId: "12", fieldName: "reference_images", fieldValue: values.imagePaths },
    ] });
  });

  it("orders numbered fields and leaves unused optional fields blank", () => {
    const graph = parseWorkflow({
      "5": { class_type: "Ref2VA", inputs: { prompt: "", aspect_ratio: "16:9", duration: "10", image3: "", image_2: "", image1: "" } },
    });
    expect(planWorkflow(graph)(values)).toMatchObject({ nodeInfoList: [
      { fieldName: "prompt", fieldValue: values.prompt }, { fieldName: "aspect_ratio", fieldValue: "9:16" },
      { fieldName: "duration", fieldValue: "12" }, { fieldName: "image1", fieldValue: "api/first.png" },
      { fieldName: "image_2", fieldValue: "api/second.webp" },
    ] });
  });

  it("rejects ambiguous or mismatched fields without sending extra sample images", () => {
    const inputs = { prompt: "", ratio: "9:16", duration: 12 };
    const graph = parseWorkflow({
      "1": { class_type: "Video", inputs: { ...inputs, image1: "", image2: "", image3: "unrequested.png" } },
    });
    expect(() => planWorkflow(graph)(values)).toThrow("2 ภาพ");
    const ambiguous = parseWorkflow({
      "1": { class_type: "Video", inputs: { ...inputs, image1: "", image2: "" } },
      "2": { class_type: "Text", inputs: { prompt: "" } },
    });
    expect(() => planWorkflow(ambiguous)).toThrow("พรอมป์");
  });

  it("sets native H3 geometry, frames and dynamic image links on a per-job copy of the graph", () => {
    const graph = parseWorkflow({
      "1": { class_type: "LoadImage", inputs: { image: "sample.png" } },
      "7": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { width: 1024, height: 576, length: 124,
        prompt: "old", "ref_images.ref_image_0": ["1", 0], "ref_videos.ref_video_0": ["8", 0], clip: ["9", 0] } },
    });
    const result = planWorkflow(graph)(values);
    expect(result).toHaveProperty("workflow");
    if (!("workflow" in result)) throw new Error("Expected native API graph");
    const sent = parseWorkflow(result.workflow);
    expect(sent["7"].inputs).toEqual({
      width: 576, height: 1024, length: 288, prompt: values.prompt,
      clip: ["9", 0], "ref_images.ref_image_0": ["2", 0], "ref_images.ref_image_1": ["3", 0],
    });
    expect(sent["2"].inputs.image).toBe("api/first.png");
    expect(sent["3"].inputs.image).toBe("api/second.webp");
    expect(graph["7"].inputs.prompt).toBe("old");
  });

  it("reads timing and checks that the picture tags match the attached slots even if a tag is repeated", () => {
    expect(videoDuration(values.prompt)).toBe(12);
    expect(videoRatio(values.prompt)).toBe("9:16");
    expect(validPictureSlots(values.prompt + " <Picture 1>", [{ index: 1 }, { index: 2 }])).toBe(true);
    expect(validPictureSlots(values.prompt, [{ index: 1 }])).toBe(false);
    expect(validPictureSlots(values.prompt, [{ index: 1 }, { index: 2 }, { index: 3 }])).toBe(false);
  });
});
