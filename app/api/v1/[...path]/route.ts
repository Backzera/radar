import { handle } from "@/server/api";
export const dynamic = "force-dynamic";
export const GET = handle;
export const POST = handle;
// Deletes products, photos, costs and users; without this export the framework
// answers 405 before the request reaches the API router.
export const DELETE = handle;
