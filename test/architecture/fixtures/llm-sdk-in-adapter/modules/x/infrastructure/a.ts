// Bad fixture: a module other than llm imports the openai SDK directly.
import OpenAI from 'openai';

export const a = (): OpenAI => new OpenAI({ apiKey: 'x' });
