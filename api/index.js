import { handle } from "../server/router.js";

export function GET(request) {
  return handle(request);
}

export function POST(request) {
  return handle(request);
}

export function PATCH(request) {
  return handle(request);
}

export function PUT(request) {
  return handle(request);
}

export function DELETE(request) {
  return handle(request);
}

export function OPTIONS(request) {
  return handle(request);
}

export default { fetch: handle };
