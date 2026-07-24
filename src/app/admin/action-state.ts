export type ActionResult = {
  success: boolean
  message: string
  fieldErrors?: Record<string, string>
  correlationId?: string
  invitationCode?: string
}

export const initialActionResult: ActionResult = {
  success: false,
  message: ''
}
