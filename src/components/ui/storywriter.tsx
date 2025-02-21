import { NextRequest, NextResponse } from "next/server";
import { RunEventType, RunOpts } from "@gptscript-ai/gptscript";
import g from "@/lib/gptScriptInstance";

// Constants
const SCRIPT_PATH = "app/api/run-script/story-book.gpt";
const REQUIRED_FIELDS = ["story", "pages"] as const;

// Types
interface RequestBody {
  story: string;
  pages: number;
  path?: string;
}

interface StreamEvent {
  type: "event" | "error";
  data: unknown;
}

// Utility function to validate request body
function validateBody(body: Partial<RequestBody>): body is RequestBody {
  return REQUIRED_FIELDS.every((field) => 
    field in body && 
    body[field] !== undefined && 
    body[field] !== null
  ) && typeof body.story === "string" && 
     typeof body.pages === "number";
}

// Main handler
export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json() as Partial<RequestBody>;
    if (!validateBody(body)) {
      return NextResponse.json(
        { error: "Invalid request: 'story' (string) and 'pages' (number) are required" },
        { status: 400 }
      );
    }

    const { story, pages, path } = body;

    // Configure script options
    const opts: RunOpts = {
      disableCache: true,
      input: `----story ${story} ---pages ${pages} ----${path || ""}`,
    };

    // Create encoder for stream
    const encoder = new TextEncoder();

    // Create readable stream
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const run = await g.run(SCRIPT_PATH, opts);

          // Stream events as they occur
          run.on(RunEventType.Event, (data) => {
            const event: StreamEvent = { type: "event", data };
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(event)}\n\n`
              )
            );
          });

          // Wait for completion
          await run.text();
          controller.close();
        } catch (error) {
          // Stream error to client
          const event: StreamEvent = { 
            type: "error", 
            data: error instanceof Error ? error.message : "Unknown error"
          };
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(event)}\n\n`
            )
          );
          controller.close();
        }
      },
      cancel() {
        console.log("Stream cancelled by client");
      }
    });

    // Return streaming response
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no" // Disable buffering for some proxies
      }
    });

  } catch (error) {
    // Handle initial setup errors
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// Configuration for Next.js
export const config = {
  api: {
    bodyParser: true,
  },
};
