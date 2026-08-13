import type { FunctionResponse } from "../types/types";
import returnCreator from "../utils/returnCreator";
import Scraper from "./scraper";
import { load } from "cheerio";

const BASE_URL = "https://duckduckgo.com/html/?q=";

export default async function getPagesURLs(queries: string[]): Promise<FunctionResponse> {
    
}