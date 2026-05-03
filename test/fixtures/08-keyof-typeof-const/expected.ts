import mint from "mintz";

const HttpStatus = { Ok: 200, NotFound: 404, ServerError: 500 } as const;

export const names = ["NotFound", "Ok", "ServerError"] as const;
export const values = [200, 404, 500] as const;
