import mint from "mintz";

const HttpStatus = { Ok: 200, NotFound: 404, ServerError: 500 } as const;

export const names = mint<keyof typeof HttpStatus>();
export const values = mint<(typeof HttpStatus)[keyof typeof HttpStatus]>();
