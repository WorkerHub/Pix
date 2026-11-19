export class MockAi {
  constructor(
    public handler: (model: string, inputs: any) => Promise<any> | any = async (
      _model,
      inputs
    ) => ({
      translated_text: `[en] ${inputs.text}`
    })
  ) {}

  async run(model: any, inputs: any, _options?: any): Promise<any> {
    return this.handler(model, inputs)
  }
}
